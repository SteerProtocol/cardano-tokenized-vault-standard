/** A successful observation never survives a different head, connection generation or process. */
import { rmSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { afterEach, expect, it, vi } from "vitest";
import { KupoReconciliation } from "../../src/chain/kupo-reconciliation.js";
import { Runner } from "../../src/runner.js";
import { active, kupoFixture, transport } from "./kupo-fixture.js";

const cleanups: (() => void)[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();

  for (const clean of cleanups.splice(0).reverse()) clean();
});

function fixture() {
  const f = kupoFixture();

  cleanups.push(() => rmSync(f.directory, { recursive: true }));

  return f;
}

it("reconciles two committed heads bracketed by connected health and declared wildcard coverage", async () => {
  const f = fixture();
  const fetcher = transport(f.target.point);

  expect(f.reconciliation.status(f.target).verification).toBe("unverified");
  await f.reconciliation.check(f.target, active());
  expect(f.reconciliation.status(f.target)).toMatchObject({
    verification: "verified",
    reason: "reconciled",
    reachable: true,
    basis: f.target,
    coverage: "operator_declared",
  });
  expect(fetcher.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
    "/health",
    "/checkpoints",
    "/patterns",
    "/checkpoints",
    "/health",
  ]);

  for (const [, options] of fetcher.mock.calls) {
    expect(options?.redirect).toBe("error");
    expect(new Headers(options?.headers).has("if-none-match")).toBe(false);
  }
});

it("expires from probe start using monotonic time, including a slow successful probe", async () => {
  const f = fixture();
  let now = 100;

  vi.spyOn(performance, "now").mockImplementation(() => now);
  transport(f.target.point);
  await f.reconciliation.check(f.target, active());
  now += f.config.limits.lookupMaxAgeMs;
  expect(f.reconciliation.status(f.target).reason).toBe("observation_expired");
  transport(f.target.point, async (_path, result, call) => {
    if (call === 5) now += f.config.limits.lookupMaxAgeMs;

    return result;
  });
  await f.reconciliation.check(f.target, active());
  expect(f.reconciliation.status(f.target).verification).toBe("unverified");
});

it("invalidates immediately on forward, rollback, disconnect, failure, shutdown and restart", async () => {
  const f = fixture();
  const runner = new Runner(f.config);

  cleanups.push(() => runner.close());
  runner.restore();
  runner.intersect(f.config.intersection, f.block.point);
  expect(runner.lookupTarget()).toBeNull();
  runner.forward(f.block, f.block.point);
  transport(f.block.point);
  await runner.kupo.check(runner.lookupTarget(), active());
  expect(runner.status().lookupReady).toBe(true);

  const next = {
    parent: f.block.point,
    point: { slot: 2n, blockHash: "ab".repeat(32) },
    transactions: [],
  };

  runner.forward(next, next.point);
  expect(runner.status().lookupReady).toBe(false);
  runner.backward(f.block.point, f.block.point);
  expect(runner.status().lookupReady).toBe(false);
  await runner.kupo.check(runner.lookupTarget(), active());
  expect(runner.status().lookupReady).toBe(true);
  runner.disconnect();
  expect(runner.status().lookupReady).toBe(false);
  runner.intersect(f.block.point, f.block.point);
  expect(runner.status().lookupReady).toBe(false);
  await runner.kupo.check(runner.lookupTarget(), active());
  runner.fail(new Error("offline"));
  expect(runner.status().lookupReady).toBe(false);

  const restarted = new Runner(f.config);

  cleanups.push(() => restarted.close());
  restarted.restore();
  restarted.intersect(f.block.point, f.block.point);
  expect(restarted.status().lookupReady).toBe(false);
  await restarted.kupo.check(restarted.lookupTarget(), active());
  expect(restarted.status().lookupReady).toBe(true);
  restarted.close();
  expect(restarted.lookupTarget()).toBeNull();
});

it("rejects late observations after a rollback and superseded overlapping probes", async () => {
  const f = fixture();

  let release = () => {};

  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  transport(f.target.point, async (_path, result, call) => {
    if (call === 1) await gate;

    return result;
  });

  const pending = f.reconciliation.check(f.target, active());
  const recovered = { ...f.target, recoveryGeneration: 3 };

  expect(f.reconciliation.status(f.target).verification).toBe("unverified");
  transport(f.target.point);
  await f.reconciliation.check(recovered, active());
  release();
  await pending;
  expect(f.reconciliation.status(f.target).verification).toBe("unverified");
  expect(f.reconciliation.status(recovered).verification).toBe("verified");
  expect(f.reconciliation.status({ ...recovered, instance: "restarted" }).verification).toBe(
    "unverified",
  );
});

it("never grants lookup readiness to a lag-tolerant reader behind its observed tip", async () => {
  const f = fixture();

  f.config.limits.maxLagSlots = 10;

  const runner = new Runner(f.config);

  cleanups.push(() => runner.close());
  runner.restore();
  runner.intersect(f.config.intersection, f.block.point);
  runner.forward(f.block, { slot: 2n, blockHash: "ab".repeat(32) });
  expect(runner.status().readerReady).toBe(true);
  expect(runner.lookupTarget()).toBeNull();
  transport(f.block.point);
  await runner.kupo.check(runner.lookupTarget(), active());
  expect(runner.status().lookupReady).toBe(false);
  expect(runner.status().kupo.reason).toBe("reader_not_current");
  expect(new KupoReconciliation(f.config).status(f.target).basis).toBeNull();
});

it("does not publish an awaited successful probe after the reader rolls back to the same point", async () => {
  const f = fixture();
  const runner = new Runner(f.config);

  cleanups.push(() => runner.close());
  runner.restore();
  runner.intersect(f.config.intersection, f.block.point);
  runner.forward(f.block, f.block.point);

  let release = () => {};

  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  transport(f.block.point, async (_path, result, call) => {
    if (call === 1) await gate;

    return result;
  });

  const pending = runner.kupo.check(runner.lookupTarget(), active());
  const next = {
    parent: f.block.point,
    point: { slot: 2n, blockHash: "ab".repeat(32) },
    transactions: [],
  };

  runner.forward(next, next.point);
  runner.backward(f.block.point, f.block.point);
  release();
  await pending;
  expect(runner.status().lookupReady).toBe(false);
  expect(runner.status().kupo.reason).toBe("reader_changed");
});
