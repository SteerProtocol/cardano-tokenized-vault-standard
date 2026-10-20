/** Actual Ogmios backward messages drive reconciliation; HTTP clients retain no recovery state. */
import { expect } from "vitest";
import { capture } from "../../support/capture.js";
import { eventually, write } from "../../support/environment.js";
import type { Flow } from "../../support/flow.js";
import { reconcileFork } from "../../support/lookup.js";
import type { BatchBranch } from "./batch-forks.js";
import { batchPoint, batchQueries } from "./batch-read.js";
import { restoredBatch, restoredInputs, rollbackInventory } from "./batch-rollback-checks.js";

export async function reverseBatch(f: Flow, branch: BatchBranch, phase: "delivery" | "settlement") {
  const label = `rollback-${branch.step.stage}-${phase}`;
  const fork = phase === "delivery" ? branch.deliveryFork : branch.settlementFork;
  const receipt = phase === "delivery" ? branch.delivered : branch.settled;
  const requested = batchQueries(
    f,
    branch.step,
    branch.refs[0],
    phase === "delivery" ? branch.claims[0] : undefined,
  );
  const before = await f.vault.read(requested);
  const chain = await capture(f.env.config, f.env.directory, `${label}-events`);

  try {
    await eventually(
      async () => (chain.observed.has(receipt.txId) ? true : undefined),
      "capture observed original batch",
    );
    await reconcileFork(f, fork.node, label, requested);

    const after = await batchPoint(
      f,
      branch.step,
      branch.refs,
      label,
      phase === "delivery" ? branch.claims : undefined,
    );

    expect(after[0].basis.instance).toBe(before.basis.instance);
    expect(after[0].basis.recoveryGeneration).toBeGreaterThan(before.basis.recoveryGeneration);
    await restoredBatch(f, branch, after, phase, label);
    await restoredInputs(f, receipt, label);
    await rollbackInventory(f, after, label);
    await expect(f.vault.read(requested, { expectedBasis: before.basis })).rejects.toMatchObject({
      code: "STALE_BASIS",
    });
    await eventually(
      async () => chain.rollbacks.find((event) => event.point.blockHash === fork.common.blockHash),
      "real mixed-batch rollback target",
    );
    expect(chain.failures).toEqual([]);
    write(f.env.directory, `${label}-result`, {
      passed: true,
      phase,
      step: branch.step,
      before,
      after,
      common: fork.common,
      rollbacks: chain.rollbacks,
      orphan: receipt.txId,
    });

    return after;
  } finally {
    await chain.close();
  }
}
