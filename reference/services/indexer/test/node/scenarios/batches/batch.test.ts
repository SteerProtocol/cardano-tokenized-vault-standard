/** SDK-07: live positive/negative/zero-net mixed settlement with ADA and native underlying. */
import assert from "node:assert/strict";
import { expect, it } from "vitest";
import { nativeInventory } from "../../support/assets.js";
import { write } from "../../support/environment.js";
import { withNode } from "../../support/fixture.js";
import { peer, receipts } from "../../support/flow.js";
import { lookupReady } from "../../support/lookup.js";
import { persistentRestart } from "../../support/persistence.js";
import { recoverySetup } from "../../support/setup.js";
import { lifecycle } from "../async/async-lifecycle.js";
import { mixedBatch } from "./batch-flow.js";
import { batchQueries } from "./batch-read.js";
import { batchVectors } from "./batch-vectors.js";

it.each(["ada", "native"] as const)(
  "accepts CTVS-2 %s mixed issuance, mixed burning and zero-net batches through stateless HTTP reads",
  async (underlying) => {
    return withNode({ family: "ctvs2" }, async ({ env, capture }) => {
      const chain = await capture("mixed-batch-events");

      const f = await recoverySetup(env, underlying);
      const actor = await peer(f);
      const seeded = await lifecycle(f, actor, "deposit");

      expect(seeded.data.snapshot.state).toMatchObject({
        sequence: 1n,
        backingAssets: 100000000n,
        economicSupply: 100000000n,
        accruedFees: 1000000n,
        storageLovelace: 10000000n,
      });

      const batches = [];

      for (const step of batchVectors) {
        batches.push(await mixedBatch(f, step, actor));
        await nativeInventory(f);
      }

      await receipts(f, chain);
      await chain.close();

      const last = batches.at(-1);

      assert.ok(last);

      const final = await persistentRestart(
        f,
        batchQueries(f, last.step, last.refs[0], last.claims[0]),
        "mixed-batch-restart",
        true,
      );
      const status = await lookupReady(env, "mixed-batch-final");

      expect(final.data.snapshot.state).toEqual(last.after[0].data.snapshot.state);
      await nativeInventory(f);
      write(env.directory, "mixed-batch-result", {
        passed: true,
        network: env.config.network,
        deployment: f.installed.deployment,
        underlying: f.installed.terms.underlying,
        actor: actor.hash,
        seeded,
        batches,
        final,
        status,
        coverage: [
          "mixed issuance",
          "mixed burning",
          "zero-net settlement",
          "grouped delivery",
          "persistent restart",
        ],
      });
    });
  },
  240000,
);
