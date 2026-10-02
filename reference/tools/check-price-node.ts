/** Opt-in, funded disposable-network acceptance. Never run against mainnet or a real user's key. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as p from "@ctvs/protocol";
import { CML, Kupmios, Lucid, SLOT_CONFIG_NETWORK } from "@lucid-evolution/lucid";
import { bootstrapPrice } from "../testing/fixtures/price/index.js";
import { writePriceEvidence } from "../testing/fixtures/price/record.js";
import { RECEIPTS, VALUE } from "../testing/fixtures/price/scripts.js";
import { RecordedEvaluator } from "../testing/ledger/evaluator.js";
import { only } from "../testing/ledger/serialization.js";

const genesisPath = process.env.CTVS_PRICE_TEST_GENESIS;
const keyPath = process.env.CTVS_PRICE_TEST_KEY;
const kupo = process.env.CTVS_PRICE_TEST_KUPO;
const ogmios = process.env.CTVS_PRICE_TEST_OGMIOS;

assert.ok(genesisPath && keyPath && kupo && ogmios, "Provide all four CTVS_PRICE_TEST_* settings");

const genesis = JSON.parse(readFileSync(genesisPath, "utf8")) as {
  systemStart: string;
  slotLength: number;
  networkMagic: number;
};

assert.equal(
  genesis.networkMagic,
  42,
  "Only the documented disposable magic-42 network is allowed",
);

const key = JSON.parse(readFileSync(keyPath, "utf8")) as { cborHex: string; type: string };

assert.equal(key.type, "PaymentSigningKeyShelley_ed25519");
assert.match(key.cborHex, /^5820[0-9a-f]{64}$/);

const privateKey = CML.PrivateKey.from_normal_bytes(Buffer.from(key.cborHex.slice(4), "hex"));

SLOT_CONFIG_NETWORK.Custom = {
  zeroTime: Date.parse(genesis.systemStart),
  zeroSlot: 0,
  slotLength: genesis.slotLength * 1000,
};

const provider = new Kupmios(kupo, ogmios);
const evaluator = new RecordedEvaluator();
const lucid = await Lucid(provider, "Custom", { evaluator });

lucid.selectWallet.fromPrivateKey(privateKey.to_bech32());
privateKey.free();

const fixture = await bootstrapPrice(lucid, provider, "node", evaluator, async () => {});

for (const source of ["witness", "reference"] as const) {
  await fixture.reject(
    `false-price-${source}`,
    fixture.checkpoint(
      source,
      fixture.claim([{ kind: "ConvertToAssets", shares: RECEIPTS, assets: VALUE + 1n }]),
      VALUE + 1n,
    ),
  );

  const id = await fixture.submit(`checkpoint-${source}`, fixture.checkpoint(source));

  fixture.position = only(
    await provider.getUtxosByOutRef([{ txHash: id, outputIndex: 0 }]),
    "Missing node output",
  );
  assert.deepEqual(p.decodeData(fixture.position.datum ?? ""), p.constr(0, [VALUE]));
  assert.equal(
    fixture.position.assets[fixture.scripts.receipt.policy + fixture.scripts.receipt.name],
    RECEIPTS,
  );
  writePriceEvidence("node", `observed-${source}`, {
    txId: id,
    output: fixture.position,
    nodeAccepted: true,
    network: "isolated magic 42",
    genesis,
    scope: "checkpoint only; issuer-controlled native market",
  });
}

console.log(
  "Price witness and reference checkpoints submitted and observed on isolated magic-42 node",
);
