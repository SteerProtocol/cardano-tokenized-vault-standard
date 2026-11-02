/** SDK-07: intended rejections execute on a disposable ledger; the HTTP SDK carries no recovery state. */
import { expect, it } from "vitest";
import { nativeInventory } from "../../support/assets.js";
import { write } from "../../support/environment.js";
import { withNode } from "../../support/fixture.js";
import { peer, receipts } from "../../support/flow.js";
import { lookupReady } from "../../support/lookup.js";
import { persistentRestart, statelessRead } from "../../support/persistence.js";
import { recoverySetup } from "../../support/setup.js";
import { maintenancePoint, maintenanceRead } from "../maintenance/maintenance.js";
import { maintenanceSeed } from "../shared/seed.js";
import { asyncRejections } from "./rejection-async.js";
import { commonRejections } from "./rejection-common.js";
import { withdrawalAccount } from "./rejection-control.js";
import { directRejections } from "./rejection-direct.js";

it.each([
  { family: "ctvs1", underlying: "ada" },
  { family: "ctvs1", underlying: "native" },
  { family: "ctvs2", underlying: "ada" },
  { family: "ctvs2", underlying: "native" },
] as const)(
  "rejects $family $underlying intended invalid candidates without changing accepted history",
  async ({ family, underlying }) => {
    return withNode({ family }, async ({ env, capture }) => {
      const chain = await capture("rejection-events");

      const f = await recoverySetup(env, underlying);
      const actor = await peer(f);
      const history = await maintenanceSeed(f, actor);
      const withdrawal = await withdrawalAccount(f);
      const requested = maintenanceRead(f, history);

      await maintenancePoint(f, requested, "rejection-baseline");

      const common = await commonRejections(f, requested, actor, withdrawal);
      const specific =
        family === "ctvs1"
          ? { rejected: await directRejections(f, requested, actor), history: [] }
          : await asyncRejections(f, requested, actor, withdrawal);
      const rejected = [...common, ...specific.rejected];

      for (const row of rejected) expect(chain.observed.has(row.txId)).toBe(false);

      await receipts(f, chain);
      await chain.close();

      const selectedHistory = specific.history[0];
      const finalQueries = selectedHistory?.claim
        ? maintenanceRead(f, { request: selectedHistory.request, claim: selectedHistory.claim })
        : requested;
      const final = await persistentRestart(f, finalQueries, "rejection-final-restart", true);

      for (const row of specific.history)
        if (row.claim)
          await statelessRead(
            f,
            maintenanceRead(f, { request: row.request, claim: row.claim }),
            `restarted-history-${row.request.txId}`,
          );

      await nativeInventory(f);

      const status = await lookupReady(env, "rejection-final");

      write(env.directory, "rejection-result", {
        passed: true,
        network: env.config.network,
        deployment: f.installed.deployment,
        underlying: f.installed.terms.underlying,
        actor: actor.hash,
        family,
        history: specific.history,
        rejected,
        final,
        status,
      });
    });
  },
  360000,
);
