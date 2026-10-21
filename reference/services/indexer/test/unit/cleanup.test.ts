/** Failure injection verifies every owned resource closes and original scenario failures remain visible. */
import { expect, it } from "vitest";
import { Cleanup, withCleanup } from "../support/cleanup.js";

it("closes in reverse order, awaits asynchronous cleanup and closes each resource once", async () => {
  const cleanup = new Cleanup();
  const calls: number[] = [];

  cleanup.defer(() => calls.push(1));
  cleanup.defer(async () => {
    await Promise.resolve();
    calls.push(2);
  });
  await cleanup.close();
  await cleanup.close();
  expect(calls).toEqual([2, 1]);
});

it("attempts remaining shutdown after synchronous and asynchronous failures", async () => {
  const cleanup = new Cleanup();
  const calls: string[] = [];
  const failed = new Error("capture write failed");
  const rejected = new Error("relay shutdown failed");

  cleanup.defer(() => calls.push("stack stopped"));
  cleanup.defer(async () => {
    calls.push("relay");

    throw rejected;
  });
  cleanup.defer(() => {
    calls.push("capture");

    throw failed;
  });
  await expect(cleanup.close()).rejects.toMatchObject({ errors: [failed, rejected] });
  expect(calls).toEqual(["capture", "relay", "stack stopped"]);
  await expect(cleanup.close()).resolves.toBeUndefined();
});

it("returns a successful scenario result after closing its resources", async () => {
  const calls: string[] = [];
  const result = await withCleanup(async (cleanup) => {
    cleanup.defer(() => calls.push("closed"));

    return "result";
  });

  expect(result).toBe("result");
  expect(calls).toEqual(["closed"]);
});

it("retains the exact setup failure after closing resources already acquired", async () => {
  const failure = new Error("capture acquisition failed");
  const calls: string[] = [];

  await expect(
    withCleanup(async (cleanup) => {
      cleanup.defer(() => calls.push("stack stopped"));

      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(calls).toEqual(["stack stopped"]);
});

it("preserves scenario and cleanup failures together", async () => {
  const scenario = new Error("assertion failed");
  const shutdown = new Error("stop failed");

  await expect(
    withCleanup(async (cleanup) => {
      cleanup.defer(() => {
        throw shutdown;
      });

      throw scenario;
    }),
  ).rejects.toMatchObject({ errors: [scenario, { errors: [shutdown] }] });
});

it("fails a successful scenario when its cleanup fails", async () => {
  const failure = new Error("stop failed");

  await expect(
    withCleanup(async (cleanup) => {
      cleanup.defer(() => {
        throw failure;
      });
    }),
  ).rejects.toMatchObject({ errors: [failure] });
});
