/** Failed evidence collection or a failed Docker stop must not strand other owned fork containers. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { docker } from "../node/support/environment.js";
import { type ForkNode, stopCopies } from "../node/support/fork.js";

vi.mock("../node/support/environment.js", () => ({ docker: vi.fn() }));

const directories: string[] = [];
const copies: ForkNode[] = ["first", "second"].map((name) => ({
  name,
  directory: "",
  socket: "",
  keys: "",
}));

afterEach(() => {
  vi.resetAllMocks();

  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

it.each(["logs", "stop"])(
  "attempts every fork stop when one %s operation fails",
  async (operation) => {
    const directory = mkdtempSync(join(tmpdir(), "ctvs-fork-cleanup-"));
    const failure = new Error(`${operation} failed`);

    directories.push(directory);
    vi.mocked(docker).mockImplementation((args) => {
      if (args[0] === operation && args.at(-1) === "second") throw failure;

      return "captured log";
    });
    await expect(stopCopies({ directory }, copies)).rejects.toMatchObject({ errors: [failure] });
    expect(vi.mocked(docker).mock.calls.filter(([args]) => args[0] === "stop")).toEqual([
      [["stop", "second"]],
      [["stop", "first"]],
    ]);
  },
);
