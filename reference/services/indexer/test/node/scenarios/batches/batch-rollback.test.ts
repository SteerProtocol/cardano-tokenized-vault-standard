/** SDK-07: six actual mixed/zero-net reversals per asset mode and a conflicting accepted replacement. */
import assert from "node:assert/strict";
import { it } from "vitest";
import { nativeInventory } from "../../support/assets.js";
import { write } from "../../support/environment.js";
import { withNode } from "../../support/fixture.js";
import { peer, receipts } from "../../support/flow.js";
import { lookupReady } from "../../support/lookup.js";
import { persistentRestart } from "../../support/persistence.js";
import { recoverySetup } from "../../support/setup.js";
import { lifecycle } from "../async/async-lifecycle.js";
import { batchForks, replaceBatch } from "./batch-forks.js";
import { batchPoint, batchQueries } from "./batch-read.js";
import { reverseBatch } from "./batch-rollback.js";
import { finalBatch } from "./batch-rollback-checks.js";

it.each(["ada", "native"] as const)(
  "reverses CTVS-2 %s mixed issuance, mixed burning and zero-net settlement/delivery on actual forks",
  async (underlying) => {
    return withNode(
      { family: "ctvs2", fork: true, forkSecurityParam: 200 },
      async ({ env, copies, capture }) => {
        const original = await capture("mixed-original-events");

        const f = await recoverySetup(env, underlying);
        const actor = await peer(f);

        await lifecycle(f, actor, "deposit");

        const branches = await batchForks(f, actor, copies);
        const last = branches.at(-1);
        const first = branches[0];

        assert.ok(last && first);
        await receipts(f, original);
        await original.close();
        await persistentRestart(
          f,
          batchQueries(f, last.step, last.refs[0], last.claims[0]),
          "mixed-original-restart",
          true,
        );
        await batchPoint(f, last.step, last.refs, "mixed-original-restarted", last.claims);

        for (const branch of [...branches].reverse()) {
          await reverseBatch(f, branch, "delivery");
          await reverseBatch(f, branch, "settlement");
        }

        await persistentRestart(
          f,
          batchQueries(f, first.step, first.refs[0]),
          "mixed-restored-restart",
        );

        const restored = await batchPoint(f, first.step, first.refs, "mixed-restored-restarted");
        const replacement = await capture("mixed-replacement-events");
        const start = f.receipts.length;
        let accepted: Awaited<ReturnType<typeof replaceBatch>>;

        try {
          accepted = await replaceBatch(f, first, restored, actor);
          await receipts({ ...f, receipts: f.receipts.slice(start) }, replacement);
        } finally {
          await replacement.close();
        }

        await persistentRestart(
          f,
          batchQueries(f, accepted.step, accepted.refs[0], accepted.claims[0]),
          "mixed-replacement-restart",
          true,
        );

        const final = await batchPoint(
          f,
          accepted.step,
          accepted.refs,
          "mixed-final",
          accepted.claims,
        );

        await finalBatch(f, branches, accepted, final);
        await nativeInventory(f);

        const status = await lookupReady(env, "mixed-rollback-final");

        write(env.directory, "mixed-rollback-result", {
          passed: true,
          network: env.config.network,
          deployment: f.installed.deployment,
          underlying: f.installed.terms.underlying,
          actor: actor.hash,
          branches,
          restored,
          accepted,
          final,
          status,
          coverage: [
            "six real mixed-batch reversals",
            "replacement settlement and delivery",
            "persistent restart",
            "Kupo reconciliation",
          ],
        });
      },
    );
  },
  360000,
);
