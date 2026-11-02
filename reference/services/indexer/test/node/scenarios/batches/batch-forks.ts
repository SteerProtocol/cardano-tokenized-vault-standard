/** Preserve ordinary peer databases before each mixed settlement and grouped delivery. */
import assert from "node:assert/strict";
import { expect } from "vitest";
import { nativeInventory } from "../../support/assets.js";
import { type Flow, type peer, validity } from "../../support/flow.js";
import { checkpoint, type ForkNode } from "../../support/fork.js";
import { deliverBatch, pendingBatch, settleBatch } from "./batch-flow.js";
import type { BatchPair } from "./batch-read.js";
import { batchVectors } from "./batch-vectors.js";

export async function batchForks(
  f: Flow,
  actor: Awaited<ReturnType<typeof peer>>,
  copies: ForkNode[],
) {
  const branches = [];

  for (const step of batchVectors) {
    // Keep restored Requests live through the six real forks and replacement settlement.
    const { refs, before } = await pendingBatch(f, step, validity(f.w).upperPosixMs + 600000n);
    const settlementFork = await checkpoint(f.env, `${step.stage}-settlement`, copies);
    const { fixed, claims, receipt } = await settleBatch(f, step, refs, before, actor);
    const deliveryFork = await checkpoint(f.env, `${step.stage}-delivery`, copies);
    const after = await deliverBatch(f, step, refs, fixed, claims, actor);
    const delivered = f.receipts.at(-1);

    assert.ok(delivered);
    expect(delivered.stage).toBe(`${step.stage}-deliver`);
    await nativeInventory(f);
    branches.push({
      step,
      refs,
      claims,
      before,
      fixed,
      after,
      settlementFork,
      deliveryFork,
      settled: receipt,
      delivered,
    });
  }

  return branches;
}

export type BatchBranch = Awaited<ReturnType<typeof batchForks>>[number];

/** The replacement consumes the restored State and both Request escrows, conflicting with the orphan. */
export async function replaceBatch(
  f: Flow,
  branch: BatchBranch,
  restored: BatchPair,
  actor: Awaited<ReturnType<typeof peer>>,
) {
  const step = { ...branch.step, stage: `replacement-${branch.step.stage}` };
  const producer = branch.settlementFork.node;
  const { fixed, claims, receipt } = await settleBatch(
    f,
    step,
    branch.refs,
    restored,
    actor,
    producer,
  );

  expect(receipt.txId).not.toBe(branch.settled.txId);
  expect(claims).not.toEqual(branch.claims);

  const after = await deliverBatch(f, step, branch.refs, fixed, claims, actor, producer);

  return { step, refs: branch.refs, claims, fixed, after, txId: receipt.txId };
}
