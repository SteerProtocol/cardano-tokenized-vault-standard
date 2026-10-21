/** G1: real Ogmios bytes and actual phase-two-invalid collateral effects through stateless HTTP reads. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readAcceptedTransaction } from "@ctvs/integration";
import { expect, it } from "vitest";
import { wireOrder } from "../../../support/evidence/ogmios-wire.js";
import { write } from "../../support/environment.js";
import { withNode } from "../../support/fixture.js";
import { peer, receipts } from "../../support/flow.js";
import { recoverySetup } from "../../support/setup.js";
import { maintenancePoint, maintenanceRead } from "../maintenance/maintenance.js";
import { maintenanceSeed } from "../shared/seed.js";
import { includedInvalid } from "./g1-invalid.js";
import { multiTransactions } from "./g1-multi.js";
import { reconnects } from "./g1-reconnect.js";
import { sourceRefusals } from "./g1-refusals.js";
import { G1Relay } from "./g1-relay.js";

it.each([
  { family: "ctvs1", underlying: "ada" },
  { family: "ctvs1", underlying: "native" },
  { family: "ctvs2", underlying: "ada" },
  { family: "ctvs2", underlying: "native" },
] as const)(
  "retains real G1 $family $underlying chain responses and included invalid effects",
  async ({ family, underlying }) => {
    return withNode({ family, fork: true }, async ({ env, copies, capture, cleanup }) => {
      const relay = new G1Relay(env.config.sources.ogmios);

      cleanup.defer(() => relay.close());
      cleanup.defer(() => write(env.directory, "g1-wire", relay.sessions));

      const chain = await capture("g1-original-events");
      const config = JSON.parse(readFileSync(join(env.directory, "indexer.json"), "utf8"));

      config.sources.ogmios = "http://host.docker.internal:19007";
      write(env.directory, "indexer", config);

      await relay.start();

      const f = await recoverySetup(env, underlying);
      const actor = await peer(f);
      const history = await maintenanceSeed(f, actor);
      const requested = maintenanceRead(f, history);

      await maintenancePoint(f, requested, "g1-baseline");

      const multiple = await multiTransactions(f, actor);
      const invalid = await includedInvalid(f, actor, requested);

      expect(chain.observed.get(invalid.candidate.txId)?.cbor).toBe(invalid.candidate.signedCbor);

      const containing = chain.events.find(
        (event) =>
          event.direction === "forward" &&
          multiple.every((row) =>
            event.block.transactions.some((cbor) => readAcceptedTransaction(cbor).id === row.txId),
          ),
      );

      expect(containing).toBeDefined();

      const recovered = await reconnects(f, relay, requested, copies);
      const refused = await sourceRefusals(f);

      wireOrder(relay.sessions);

      expect(relay.errors).toEqual([]);
      await receipts(f, chain);
      write(env.directory, "g1-wire", relay.sessions);
      write(env.directory, "g1-result", {
        passed: true,
        family,
        underlying,
        invalid,
        recovered,
        refused,
        multiple,
        network: env.config.network,
        deployment: f.installed.deployment,
        final: recovered.restored,
      });
    });
  },
  300000,
);
