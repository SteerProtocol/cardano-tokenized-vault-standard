/** SDK-07: accepted ADA/native maintenance in both families, with stateless HTTP and exact custody. */
import { expect, it } from "vitest";
import { nativeInventory, stateCustody } from "../../support/assets.js";
import { write } from "../../support/environment.js";
import { withNode } from "../../support/fixture.js";
import { peer, readback, receipts } from "../../support/flow.js";
import { lookupReady } from "../../support/lookup.js";
import { persistentRestart } from "../../support/persistence.js";
import { recoverySetup } from "../../support/setup.js";
import { maintenanceSeed } from "../shared/seed.js";
import {
  maintenancePoint,
  maintenanceRead,
  maintenanceStep,
  maintenanceSteps,
  maintenanceViews,
} from "./maintenance.js";

it.each([
  { family: "ctvs1", underlying: "ada" },
  { family: "ctvs1", underlying: "native" },
  { family: "ctvs2", underlying: "ada" },
  { family: "ctvs2", underlying: "native" },
] as const)(
  "accepts $family $underlying fee collection, reserve top-ups and directional pause changes",
  async ({ family, underlying }) => {
    return withNode({ family }, async ({ env, capture }) => {
      const chain = await capture("maintenance-events");

      const f = await recoverySetup(env, underlying);
      const actor = await peer(f);
      const history = await maintenanceSeed(f, actor);
      const requested = maintenanceRead(f, history);
      const baseline = await maintenancePoint(f, requested, "maintenance-baseline");

      expect(baseline.data.snapshot.state).toMatchObject({
        sequence: 1n,
        backingAssets: 100000000n,
        economicSupply: 100000000n,
        accruedFees: 1000000n,
        storageLovelace: 10000000n,
        pauseFlags: 0n,
      });
      expect(baseline.data.context.stateInput.value).toEqual(
        stateCustody(f, baseline.data.snapshot.state),
      );
      expect(baseline.data.ownership.freeShares).toBe(100000000n);
      maintenanceViews(f, baseline);
      await nativeInventory(f);

      let current = baseline;

      for (const step of maintenanceSteps)
        current = await maintenanceStep(f, requested, current, step, actor);

      await receipts(f, chain);
      await chain.close();

      const final = await persistentRestart(f, requested, "maintenance-restart", true);
      const status = await lookupReady(env, "maintenance-final");

      expect(final.data.snapshot.state).toMatchObject({
        sequence: 7n,
        backingAssets: 100000000n,
        economicSupply: 100000000n,
        accruedFees: 0n,
        storageLovelace: 11000000n,
        pauseFlags: 0n,
      });
      await readback(
        f,
        "maintenance-final-state",
        final.basis.stateRef,
        final.data.context.stateInput,
      );
      await readback(f, "maintenance-config", final.data.context.deployment.configRef);
      await nativeInventory(f, 11000000n);
      write(env.directory, "maintenance-result", {
        passed: true,
        network: env.config.network,
        bootstrap: env.config.intersection,
        deployment: f.installed.deployment,
        underlying: f.installed.terms.underlying,
        actor: actor.hash,
        baseline,
        final,
        status,
        stages: f.receipts.map(({ stage, txId, bytes, evaluations }) => ({
          stage,
          txId,
          bytes,
          evaluations,
        })),
        coverage: ["directional pause", "fee collection", "reserve top-up", "persistent restart"],
      });
    });
  },
  180000,
);
