/** SDK-07: six real maintenance reversals per family/asset mode, followed by a competing accepted branch. */
import assert from "node:assert/strict";
import { expect, it } from "vitest";
import { nativeInventory } from "../../support/assets.js";
import { write } from "../../support/environment.js";
import { withNode } from "../../support/fixture.js";
import { peer, receipts } from "../../support/flow.js";

import { lookupReady } from "../../support/lookup.js";
import { persistentRestart } from "../../support/persistence.js";
import { recoverySetup } from "../../support/setup.js";
import { maintenanceSeed } from "../shared/seed.js";
import { maintenancePoint, maintenanceRead, maintenanceViews } from "./maintenance.js";
import {
  absentMaintenance,
  maintenanceForks,
  replaceMaintenance,
  reverseMaintenance,
} from "./maintenance-recovery.js";

it.each([
  { family: "ctvs1", underlying: "ada" },
  { family: "ctvs1", underlying: "native" },
  { family: "ctvs2", underlying: "ada" },
  { family: "ctvs2", underlying: "native" },
] as const)(
  "reverses $family $underlying fees, reserve top-ups and every pause change on real forks",
  async ({ family, underlying }) => {
    return withNode(
      { family, fork: true, forkSecurityParam: 200 },
      async ({ env, copies, capture }) => {
        const original = await capture("maintenance-original-events");

        const f = await recoverySetup(env, underlying);
        const actor = await peer(f);
        const requested = maintenanceRead(f, await maintenanceSeed(f, actor));
        const baseline = await maintenancePoint(f, requested, "maintenance-fork-baseline");

        maintenanceViews(f, baseline);
        await nativeInventory(f);

        const branches = await maintenanceForks(f, requested, baseline, actor, copies);

        await receipts(f, original);
        await original.close();
        await persistentRestart(f, requested, "maintenance-original-restart", true);

        for (const branch of [...branches].reverse())
          await reverseMaintenance(f, requested, branch);

        const restored = await persistentRestart(f, requested, "maintenance-restored-restart");

        expect(restored.data.snapshot).toEqual(baseline.data.snapshot);
        expect(restored.data.context.stateInput).toEqual(baseline.data.context.stateInput);
        expect(restored.data.ownership).toEqual(baseline.data.ownership);
        expect(restored.data.request).toEqual(baseline.data.request);
        expect(restored.data.claim).toEqual(baseline.data.claim);
        maintenanceViews(f, restored, baseline);

        const first = branches[0];

        assert.ok(first);

        const replacement = await capture("maintenance-replacement-events");
        const start = f.receipts.length;

        try {
          await replaceMaintenance(f, requested, restored, actor, first.fork.node);
          await receipts({ ...f, receipts: f.receipts.slice(start) }, replacement);
        } finally {
          await replacement.close();
        }

        const final = await persistentRestart(
          f,
          requested,
          "maintenance-replacement-restart",
          true,
        );

        expect(final.data.snapshot.state).toEqual({
          ...baseline.data.snapshot.state,
          sequence: 6n,
          accruedFees: 0n,
          storageLovelace: 11000000n,
        });
        expect(final.data.ownership).toEqual(baseline.data.ownership);
        expect(final.data.request).toEqual(baseline.data.request);
        expect(final.data.claim).toEqual(baseline.data.claim);
        await absentMaintenance(
          f,
          branches.map(({ receipt }) => ({ txId: receipt.txId, index: 0n })),
        );
        await nativeInventory(f, 11000000n);

        const status = await lookupReady(env, "maintenance-rollback-final");

        write(env.directory, "maintenance-rollback-result", {
          passed: true,
          network: env.config.network,
          deployment: f.installed.deployment,
          underlying: f.installed.terms.underlying,
          actor: actor.hash,
          baseline,
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
          replacement: f.receipts.slice(start).map(({ stage, txId }) => ({ stage, txId })),
          coverage: [
            "six real maintenance reversals",
            "replacement maintenance",
            "persistent restart",
            "Kupo reconciliation",
          ],
        });
      },
    );
  },
  360000,
);
