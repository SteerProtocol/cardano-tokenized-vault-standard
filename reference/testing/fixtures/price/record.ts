/** Example-specific signed evidence. Core vault wallet policies still forbid withdrawals. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CML, type Provider, type TxBuilder, withCMLScope } from "@lucid-evolution/lucid";
import { referenceRoot } from "../../../tools/lib/project.js";
import type { RecordedEvaluator } from "../../ledger/evaluator.js";

export function writePriceEvidence(directory: string, name: string, value: unknown): void {
  const path = join(referenceRoot, "artifacts/price-signed", directory);

  mkdirSync(path, { recursive: true });
  writeFileSync(
    join(path, `${name}.json`),
    `${JSON.stringify(value, (_, v: unknown) => (typeof v === "bigint" ? v.toString() : v), 2)}\n`,
  );
}

/** Verify every actual key signature over the final body; no private key is persisted. */
function verifySignatures(cbor: string, txId: string, maximum: number): void {
  assert.ok(cbor.length / 2 <= maximum, "Signed size exceeds network limit");
  withCMLScope((own) => {
    const tx = own(CML.Transaction.from_cbor_hex(cbor));
    const witnesses = own(tx.witness_set());
    const keys = witnesses.vkeywitnesses();

    assert.ok(keys && keys.len() > 0, "Expected cryptographic key witnesses");
    own(keys);

    for (let i = 0; i < keys.len(); i++) {
      const witness = own(keys.get(i));
      const key = own(witness.vkey());

      assert.ok(key.verify(Buffer.from(txId, "hex"), own(witness.ed25519_signature())));
    }
  });
}

export async function submitPrice(
  provider: Provider,
  evaluator: RecordedEvaluator,
  directory: string,
  stage: string,
  builder: TxBuilder,
): Promise<string> {
  evaluator.stage = stage;

  const built = await builder.complete({ localUPLCEval: true });
  const signed = await built.sign.withWallet().complete();
  const cbor = signed.toCBOR(),
    txId = signed.toHash();

  verifySignatures(cbor, txId, (await provider.getProtocolParameters()).maxTxSize);
  await evaluator.verifySigned(cbor);

  const record = { txId, signedCbor: cbor, bytes: cbor.length / 2, nodeAccepted: false };

  // Retain the final bytes even when submission fails before observation.
  writePriceEvidence(directory, `${stage}-candidate`, record);
  assert.equal(await signed.submit(), txId);
  // Emulator settlement is advanced by the caller; a node fixture waits for observation.
  writePriceEvidence(directory, stage, {
    txId,
    signedCbor: cbor,
    bytes: cbor.length / 2,
    evaluations: evaluator.records.filter((r) => r.stage === stage),
    resolvedInputs: evaluator.inputs.get(stage)?.additionalUTxOs,
    protocolParameters: await provider.getProtocolParameters(),
    nodeAccepted: false,
  });

  return txId;
}
