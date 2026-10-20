/** Evidence write failures still stop the owned stack and release its subnet without deleting volumes. */
import { writeFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { finish } from "../node/support/environment.js";

const { calls } = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn((_command, args: string[]) => {
    calls.push(args.join(" "));

    return "{}";
  }),
}));
vi.mock("node:fs", async (original) => ({
  ...(await original<typeof import("node:fs")>()),
  writeFileSync: vi.fn(),
}));

afterEach(() => {
  calls.length = 0;
  vi.mocked(writeFileSync).mockReset();
});

function stack() {
  return {
    directory: "/unused-mocked-evidence",
    project: "ctvs-owned",
    compose: (...args: string[]) => {
      calls.push(`compose ${args.join(" ")}`);

      return "logs";
    },
  };
}

it("stops services before releasing the owned network after evidence capture", async () => {
  await finish(stack());
  expect(calls.slice(-3)).toEqual([
    "compose logs --no-color --tail 300",
    "compose stop",
    "network rm ctvs-owned_default",
  ]);
});

it("still stops and releases the network when both snapshot and error-record writes fail", async () => {
  const failure = new Error("evidence directory unavailable");

  vi.mocked(writeFileSync).mockImplementation(() => {
    throw failure;
  });
  await expect(finish(stack())).rejects.toBe(failure);
  expect(calls.slice(-2)).toEqual(["compose stop", "network rm ctvs-owned_default"]);
});
