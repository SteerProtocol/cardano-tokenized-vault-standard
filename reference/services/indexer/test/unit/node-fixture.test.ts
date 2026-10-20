/** Disposable-stack ownership is exercised offline with failed setup, capture and shutdown operations. */
import { beforeEach, expect, it, vi } from "vitest";
import { capture } from "../node/support/capture.js";
import { environment, finish, nodeStack } from "../node/support/environment.js";
import { withNode } from "../node/support/fixture.js";
import { stopCopies } from "../node/support/fork.js";
import { prepare } from "../node/support/prepare.js";
import { setup } from "./fixtures.js";

vi.mock("../node/support/environment.js", () => ({
  environment: vi.fn(),
  finish: vi.fn(),
  nodeStack: vi.fn(),
}));
vi.mock("../node/support/prepare.js", () => ({ prepare: vi.fn() }));
vi.mock("../node/support/capture.js", () => ({ capture: vi.fn() }));
vi.mock("../node/support/fork.js", () => ({ stopCopies: vi.fn() }));

function ownedStack() {
  const fixture = setup("ctvs1");
  const stack = {
    directory: fixture.directory,
    project: "ctvs-test",
    cli: vi.fn(() => ""),
    compose: vi.fn(() => ""),
  };
  const env = {
    ...stack,
    config: fixture.config,
    reviewed: fixture.reviewed,
    genesis: { networkMagic: 42, systemStart: "2026-10-01T00:00:00Z", slotLength: 1 },
  };

  vi.mocked(prepare).mockResolvedValue(stack.directory);
  vi.mocked(nodeStack).mockReturnValue(stack);
  vi.mocked(environment).mockReturnValue(env);

  return { stack, env };
}

beforeEach(() => vi.resetAllMocks());

it("stops the acquired stack when environment validation fails before the scenario starts", async () => {
  const { stack } = ownedStack();
  const failure = new Error("genesis or build mismatch");
  const run = vi.fn();

  vi.mocked(environment).mockImplementation(() => {
    throw failure;
  });
  await expect(withNode({}, run)).rejects.toBe(failure);
  expect(stack.compose).toHaveBeenCalledWith("down");
  expect(run).not.toHaveBeenCalled();
  expect(finish).not.toHaveBeenCalled();
});

it("finishes the stack after a capture fails during acquisition", async () => {
  const { env } = ownedStack();
  const failure = new Error("intersection unavailable");

  vi.mocked(capture).mockRejectedValue(failure);
  await expect(withNode({}, async (fixture) => fixture.capture())).rejects.toBe(failure);
  expect(stopCopies).toHaveBeenCalledWith(env, []);
  expect(finish).toHaveBeenCalledWith(env);
});

it("closes capture, remaining fork copies and stack despite a relay shutdown failure", async () => {
  const { env, stack } = ownedStack();
  const close = vi.fn(async () => {});
  const failure = new Error("relay close failed");

  vi.mocked(capture).mockResolvedValue({
    observed: new Map(),
    events: [],
    failures: [],
    rollbacks: [],
    close,
  });
  vi.mocked(stopCopies).mockRejectedValue(new Error("one fork stop failed"));
  await expect(
    withNode({ directory: stack.directory }, async (fixture) => {
      await fixture.capture();
      fixture.cleanup.defer(() => {
        throw failure;
      });
    }),
  ).rejects.toBeInstanceOf(AggregateError);
  expect(close).toHaveBeenCalledOnce();
  expect(stopCopies).toHaveBeenCalledWith(env, []);
  expect(finish).toHaveBeenCalledWith(env);
  expect(prepare).not.toHaveBeenCalled();
});
