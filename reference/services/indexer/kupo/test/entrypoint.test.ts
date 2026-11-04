/** Real shell/Node/POSIX handoff; the stand-in executable reports its arguments, PID and signals. */
import { spawn } from "node:child_process";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Cleanup } from "../../test/support/cleanup.js";
import { startupFixture } from "./startup-fixture.js";

const entrypoint = fileURLToPath(new URL("../entrypoint.sh", import.meta.url));
const nativeJspi = "Suspending" in WebAssembly && "promising" in WebAssembly;
let fixture: Awaited<ReturnType<typeof startupFixture>>;
let cleanup: Cleanup;

beforeEach(async () => {
  cleanup = new Cleanup();
  fixture = await startupFixture();
  cleanup.defer(fixture.remove);
  fixture.input.registrations = fixture.input.registrations.map((registration) => ({
    ...registration,
    package: "@ctvs/example-plugin",
    deployment: { ...registration.deployment, network: fixture.input.network },
  }));
  await fixture.save();
});

afterEach(async () => {
  await cleanup.close();
});

async function launch(
  options: { arguments?: string[]; fail?: boolean; env?: NodeJS.ProcessEnv } = {},
) {
  const binary = join(fixture.root, "fake kupo");

  await writeFile(
    binary,
    `#!/usr/bin/env node
    if (process.env.FIXTURE_FAIL === "yes") {
      console.error("native Kupo refusal");
      process.exit(23);
    }
    for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => {
      console.log(signal);
      process.exit(0);
    });
    console.log(JSON.stringify({ pid: process.pid, args: process.argv.slice(2) }));
    setInterval(() => {}, 1000);
  `,
    { mode: 0o700 },
  );

  const child = spawn("sh", [entrypoint, ...(options.arguments ?? [])], {
    cwd: fixture.root,
    env: {
      ...process.env,
      CTVS_KUPO_BINARY: binary,
      CTVS_KUPO_CONFIG: fixture.options.configPath,
      CTVS_KUPO_NODE_CONFIG: fixture.options.nodeConfigPath,
      CTVS_KUPO_NODE_SOCKET: fixture.options.nodeSocketPath,
      CTVS_KUPO_DATA: fixture.options.dataDirectory,
      CTVS_KUPO_PACKAGE_CACHE: fixture.options.cacheDirectory,
      FIXTURE_FAIL: options.fail ? "yes" : "no",
      ...options.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  const exited = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });

  cleanup.defer(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");

    await exited;
  });
  child.stdout.on("data", (data) => {
    stdout += data;
  });
  child.stderr.on("data", (data) => {
    stderr += data;
  });

  return { child, exited, stdout: () => stdout, stderr: () => stderr };
}

async function supported(process: Awaited<ReturnType<typeof launch>>) {
  if (nativeJspi) return true;

  expect(await process.exited).toEqual({ code: 1, signal: null });
  expect(process.stderr()).toContain("JSPI");
  expect(process.stdout()).toBe("");

  return false;
}

it.each(["SIGINT", "SIGTERM"] as const)(
  "hands off the same PID and delivers %s to Kupo on supported runtimes",
  async (signal) => {
    const process = await launch();

    if (!(await supported(process))) return;

    await vi.waitFor(() => expect(process.stdout()).toContain("\n"), { timeout: 5000 });

    const ready = JSON.parse(process.stdout().split("\n")[0] ?? "{}");

    expect(ready.pid).toBe(process.child.pid);
    expect(ready.args).toEqual([
      "--node-socket",
      fixture.options.nodeSocketPath,
      "--node-config",
      fixture.options.nodeConfigPath,
      "--workdir",
      fixture.options.dataDirectory,
      "--host",
      "0.0.0.0",
      "--port",
      "1442",
      "--since",
      "origin",
      "--match",
      "*",
    ]);
    process.child.kill(signal);
    expect(await process.exited).toEqual({ code: 0, signal: null });
    expect(process.stdout()).toContain(signal);
  },
);

it("preserves a native Kupo refusal and exit status on supported runtimes", async () => {
  const process = await launch({ fail: true });

  if (!(await supported(process))) return;

  expect(await process.exited).toEqual({ code: 23, signal: null });
  expect(process.stderr()).toContain("native Kupo refusal");
});

it("does not launch Kupo when configuration fails", async () => {
  await writeFile(fixture.options.configPath, "{}");

  const process = await launch();

  expect(await process.exited).toEqual({ code: 1, signal: null });
  expect(process.stdout()).toBe("");
  expect(process.stderr()).toContain("must be an object");
});

it("rejects arguments that could override managed collection policy", async () => {
  const process = await launch({ arguments: ["--prune-utxo"] });

  expect(await process.exited).toEqual({ code: 1, signal: null });
  expect(process.stdout()).toBe("");
  expect(process.stderr()).toContain("does not accept command-line arguments");
});

it("reports full installation errors after long warnings and leaves storage uninitialized", async () => {
  const binaries = join(fixture.root, "bin");
  const warnings = `npm warn ${"w".repeat(100_000)}`;
  const failure = "fixture E404: requested package was not found";

  await mkdir(binaries);
  await writeFile(
    join(binaries, "npm"),
    `#!/bin/sh\nprintf '%s\\n' '${warnings}' '${failure}' >&2\nexit 7\n`,
    { mode: 0o700 },
  );
  fixture.input.additionalPackages = { "@fixture/missing": "1.0.0" };
  fixture.input.registrations = [
    {
      id: "missing",
      package: "@fixture/missing",
      deployment: {},
    },
  ];
  await fixture.save();

  const child = await launch({
    env: { PATH: `${binaries}${delimiter}${process.env.PATH ?? ""}` },
  });

  expect(await child.exited).toEqual({ code: 1, signal: null });
  expect(child.stdout()).toBe("");
  expect(child.stderr()).toContain("additional package installation failed");
  expect(child.stderr()).toContain(`${warnings}\n${failure}\n`);
  await expect(readdir(fixture.options.dataDirectory)).rejects.toMatchObject({ code: "ENOENT" });
});
