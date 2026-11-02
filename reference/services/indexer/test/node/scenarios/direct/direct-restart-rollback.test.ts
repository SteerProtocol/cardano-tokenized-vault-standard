/** SDK-07 native CTVS-1: persist exact reads and reverse all four direct actions on real forks. */
import assert from "node:assert/strict";
import { expect, it } from "vitest";
import { nativeInventory } from "../../support/assets.js";
import { write } from "../../support/environment.js";
import { withNode } from "../../support/fixture.js";
import { receipts } from "../../support/flow.js";
import { kupoRestart, lookupReady } from "../../support/lookup.js";
import { economicRead, persistentRestart } from "../../support/persistence.js";
import { recoverySetup } from "../../support/setup.js";
import { directForks, replaceDirect, reverseDirect } from "./direct-recovery.js";

it("persists CTVS-1 native state and reverses deposit, mint, withdraw and redeem on real forks", async () => {
  return withNode({ family: "ctvs1", fork: true }, async ({ env, copies, capture }) => {
    const original = await capture("original-chain-events");

    const f = await recoverySetup(env, "native");
    const branches = await directForks(f, copies);
    const requested = economicRead(f);

    await receipts(f, original);
    await original.close();
    await nativeInventory(f);
    await kupoRestart(f, requested);
    await persistentRestart(f, requested, "restart-original");
    await persistentRestart(f, requested, "restart-original-killed", true);

    for (const branch of [...branches].reverse()) await reverseDirect(f, branch);

    const restored = await persistentRestart(f, requested, "restart-restored");

    expect(restored.data.snapshot.state).toMatchObject({
      backingAssets: 0n,
      economicSupply: 0n,
      accruedFees: 0n,
      sequence: 0n,
    });
    await nativeInventory(f);

    const replacement = await capture("replacement-events");
    const fork = branches[0]?.fork;

    assert.ok(fork);

    try {
      const receipt = await replaceDirect(f, fork.node);

      await receipts({ ...f, receipts: [receipt] }, replacement);
    } finally {
      await replacement.close();
    }

    const final = await persistentRestart(f, requested, "restart-replacement", true);
    const status = await lookupReady(env, "final-reconciled");

    await nativeInventory(f);
    write(env.directory, "direct-restart-rollback-result", {
      passed: true,
      network: env.config.network,
      deployment: f.installed.deployment,
      underlying: f.installed.terms.underlying,
      branches: branches.map(({ step, fork, receipt, before, after }) => ({
        step,
        common: fork.common,
        txId: receipt.txId,
        before,
        after,
      })),
      restored,
      final,
      status,
      coverage: [
        "persistent restart",
        "four real direct-action rollbacks",
        "replacement deposit",
        "Kupo reconciliation",
      ],
    });
  });
}, 300000);
