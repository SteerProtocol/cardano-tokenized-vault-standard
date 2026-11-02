/** SDK-07: persistent Docker restarts and genuine node-selected forks; HTTP client stays stateless. */
import { expect, it } from "vitest";
import { nativeInventory } from "../../support/assets.js";
import { eventually, write } from "../../support/environment.js";
import { withNode } from "../../support/fixture.js";
import { receipts } from "../../support/flow.js";

import { kupoRestart, lookupReady } from "../../support/lookup.js";
import { persistentRestart } from "../../support/persistence.js";
import { recoverySetup } from "../../support/setup.js";
import { originalBranch, rollbackDelivery, rollbackSettlement } from "./rollback-flow.js";

it.each([
  { underlying: "ada", kind: "deposit" },
  { underlying: "native", kind: "deposit" },
  { underlying: "native", kind: "redeem" },
] as const)(
  "persists CTVS-2 $underlying $kind across restarts and real delivery/settlement rollbacks",
  async ({ underlying, kind }) => {
    return withNode({ family: "ctvs2", fork: true }, async ({ env, copies, capture }) => {
      let chain = await capture("original-chain-events");

      const f = await recoverySetup(env, underlying);
      const branch = await originalBranch(f, copies, kind);

      await receipts(f, chain);
      await chain.close();

      await kupoRestart(f, branch.requested);

      const restarted = await persistentRestart(f, branch.requested, "restart-delivered");

      chain = await capture("delivery-fork-events");
      await eventually(
        async () => (chain.observed.has(branch.delivered.txId) ? true : undefined),
        "reconnected capture caught up",
      );
      await rollbackDelivery(f, branch, chain);
      await chain.close();
      await persistentRestart(f, branch.requested, "restart-after-rollback");
      chain = await capture("settlement-fork-events");

      const final = await rollbackSettlement(f, branch, chain);

      expect(chain.failures).toEqual([]);
      expect(chain.rollbacks.length).toBeGreaterThanOrEqual(1);

      const status = await lookupReady(env, "final-reconciled");

      expect(status.readerHead).toEqual(status.durableHead);
      expect(status.lookupReady).toBe(true);
      await nativeInventory(f);
      write(env.directory, "restart-rollback-result", {
        status,
        passed: true,
        network: env.config.network,
        deployment: f.installed.deployment,
        underlying: f.installed.terms.underlying,
        kind,
        request: branch.ref,
        claim: branch.claimRef,
        original: branch.original,
        restarted,
        final,
        forks: [branch.deliveryFork.common, branch.requestFork.common],
        coverage: [
          "persistent restart",
          "real delivery and settlement rollback",
          "replacement cancellation",
          "Kupo reconciliation",
        ],
      });
    });
  },
  180000,
);
