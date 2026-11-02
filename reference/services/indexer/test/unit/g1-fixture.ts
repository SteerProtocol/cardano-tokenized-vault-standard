/** Retained real G1 sessions drive the production adapter/runner; temporary files preserve exact genesis bytes. */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { acceptedBlock, chainPoint } from "../../src/chain/ogmios.js";
import { loadConfig } from "../../src/config.js";
import { Runner } from "../../src/runner.js";
import ada1 from "../fixtures/accepted/g1-ctvs1-ada.json" with { type: "json" };
import native1 from "../fixtures/accepted/g1-ctvs1-native.json" with { type: "json" };
import ada2 from "../fixtures/accepted/g1-ctvs2-ada.json" with { type: "json" };
import native2 from "../fixtures/accepted/g1-ctvs2-native.json" with { type: "json" };
import type { RelaySession } from "../support/evidence/ogmios-wire.js";
import { negotiation, rpc } from "../support/evidence/ogmios-wire.js";

export const g1Fixtures = [ada1, native1, ada2, native2];
export type G1Fixture = (typeof g1Fixtures)[number];
export const g1Cases = g1Fixtures.map((fixture) => ({
  fixture,
  label: `${fixture.expected.family} ${fixture.expected.underlying}`,
}));

export function g1Sessions(fixture: G1Fixture): RelaySession[] {
  return fixture.wire.map((session) => ({
    ...session,
    messages: session.messages.map((message) => {
      assert.ok(message.direction === "request" || message.direction === "response");

      return { direction: message.direction, wire: message.wire };
    }),
  }));
}

export function g1Setup(fixture: G1Fixture) {
  const directory = mkdtempSync(join(tmpdir(), "ctvs-g1-"));
  const genesisPath = join(directory, "genesis.json");
  const filename = join(directory, "config.json");

  writeFileSync(genesisPath, fixture.genesis);
  writeFileSync(
    filename,
    JSON.stringify({
      ...fixture.configuration,
      genesisPath,
      database: join(directory, "journal.sqlite"),
    }),
  );

  const config = loadConfig(filename);
  const runner = new Runner(config);

  runner.restore();

  return { directory, config, runner };
}

export function g1Disk(database: string) {
  const db = new DatabaseSync(database, { readOnly: true });

  try {
    return db
      .prepare("SELECT body FROM blocks ORDER BY sequence")
      .all()
      .map((row) => JSON.parse(String(row.body)) as unknown);
  } finally {
    db.close();
  }
}

export function g1ApplySession(
  runner: Runner,
  session: RelaySession,
  observe: () => void = () => {},
) {
  const result = negotiation(session).response.result;

  assert.ok(result?.intersection && result.tip);
  runner.intersect(chainPoint(result.intersection), chainPoint(result.tip));
  observe();

  for (const row of session.messages) {
    const message = rpc(row.wire);

    if (row.direction !== "response" || message.method !== "nextBlock") continue;

    const event = message.result;

    assert.ok(event?.tip);

    if (event.direction === "forward") {
      assert.ok(event.block);
      runner.forward(acceptedBlock(event.block, runner.status().readerHead), chainPoint(event.tip));
    } else {
      assert.ok(event.point);
      runner.backward(chainPoint(event.point), chainPoint(event.tip));
    }

    observe();
  }
}
