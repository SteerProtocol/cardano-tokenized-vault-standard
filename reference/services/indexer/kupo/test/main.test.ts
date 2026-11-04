import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { main, startupDiagnostic } from "../src/main.js";
import { prepareKupo } from "../src/startup.js";

vi.mock("../src/startup.js", () => ({ prepareKupo: vi.fn() }));

const argv = process.argv;
const exitCode = process.exitCode;
const signals = ["SIGINT", "SIGTERM"] as const;
let listeners: number[];

beforeEach(() => {
  listeners = signals.map((signal) => process.listenerCount(signal));
  process.argv = [process.execPath, "kupo-startup"];
  vi.stubEnv("CTVS_KUPO_BINARY", process.execPath);
  vi.spyOn(process, "execve").mockImplementation(() => {
    throw new Error("handoff");
  });
});

afterEach(() => {
  expect(signals.map((signal) => process.listenerCount(signal))).toEqual(listeners);
  process.argv = argv;
  process.exitCode = exitCode;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.mocked(prepareKupo).mockReset();
});

it("hands the prepared argument array and environment to the native process replacement", async () => {
  vi.mocked(prepareKupo).mockResolvedValue(["--match", "*", "--workdir", "/data with spaces"]);
  await expect(main()).rejects.toThrow("handoff");
  expect(process.execve).toHaveBeenCalledWith(
    process.execPath,
    [process.execPath, "--match", "*", "--workdir", "/data with spaces"],
    process.env,
  );
});

it("passes an explicitly configured package registry to preparation", async () => {
  vi.stubEnv("CTVS_KUPO_REGISTRY", "https://registry.example/");
  vi.mocked(prepareKupo).mockResolvedValue([]);
  await expect(main()).rejects.toThrow("handoff");
  expect(prepareKupo).toHaveBeenCalledWith(
    expect.objectContaining({
      registry: "https://registry.example/",
    }),
  );
});

it.each([
  ["SIGINT", 130],
  ["SIGTERM", 143],
] as const)("cancels preparation on %s without handing off", async (signal, code) => {
  vi.mocked(prepareKupo).mockImplementation(async (options) => {
    process.emit(signal);
    options.signal.throwIfAborted();

    return [];
  });
  await expect(main()).rejects.toThrow(`Kupo startup interrupted by ${signal}`);
  expect(process.exitCode).toBe(code);
  expect(process.execve).not.toHaveBeenCalled();
});

it("propagates preparation failures without executing Kupo", async () => {
  vi.mocked(prepareKupo).mockRejectedValue(new Error("discovery failed"));
  await expect(main()).rejects.toThrow("discovery failed");
  expect(process.execve).not.toHaveBeenCalled();
});

it("rejects unsupported runtimes before preparation", async () => {
  vi.stubGlobal("process", { ...process, execve: undefined });

  try {
    await expect(main()).rejects.toThrow("POSIX process.execve");
    expect(prepareKupo).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

it("refuses command-line overrides before preparation", async () => {
  process.argv.push("--prune-utxo");
  await expect(main()).rejects.toThrow("does not accept command-line arguments");
  expect(prepareKupo).not.toHaveBeenCalled();
});

it("requires an executable before preparation", async () => {
  vi.stubEnv("CTVS_KUPO_BINARY", "");
  await expect(main()).rejects.toThrow("CTVS_KUPO_BINARY");
  vi.stubEnv("CTVS_KUPO_BINARY", "/missing-kupo-executable");
  await expect(main()).rejects.toThrow("ENOENT");
  expect(prepareKupo).not.toHaveBeenCalled();
});

it("preserves wrapped startup error messages without printing stacks", () => {
  const cause = new Error("npm E404: requested package was not found");
  const error = new Error("additional package installation failed", { cause });

  expect(startupDiagnostic(error)).toBe(
    "additional package installation failed\nCaused by: npm E404: requested package was not found",
  );
});

it("preserves full messages throughout a long cause chain", () => {
  const messages = Array.from({ length: 6 }, (_, index) => `${index}: ${"x".repeat(10_000)}`);
  const error = messages.reduceRight<Error | undefined>(
    (cause, message) => new Error(message, { cause }),
    undefined,
  );

  expect(startupDiagnostic(error)).toBe(messages.join("\nCaused by: "));
});

it("stops at a repeated error in a cyclic cause chain", () => {
  const cause = new Error("underlying failure");
  const error = new Error("startup failed", { cause });

  cause.cause = error;

  expect(startupDiagnostic(error)).toBe("startup failed\nCaused by: underlying failure");
});

it("uses a generic diagnostic for non-error failures", () => {
  expect(startupDiagnostic({ privateContext: "do not serialize" })).toBe("Kupo startup failed");
});
