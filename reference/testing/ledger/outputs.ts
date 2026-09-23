/** Checks indexed protocol outputs independently of the wallet-wide effects verifier. */
import assert from "node:assert/strict";
import type { IndexedOutput } from "@ctvs/planning";
import { decodeData, equalData } from "@ctvs/protocol";
import { CML, coreToTxOutput } from "@lucid-evolution/lucid";
import { ledgerAddress, ledgerValue } from "./serialization.js";

/**
 * Read protected outputs at their committed indices from completed or signed CBOR.
 * Full address, value, datum and reference-script checks catch balancing adjustments
 * that would invalidate protocol intent. Additional funding/change outputs are outside
 * this check and require the separate wallet-wide effects review before signing.
 */
export function assertProtectedOutputs(cbor: string, planned: readonly IndexedOutput[]): void {
  const transaction = CML.Transaction.from_cbor_hex(cbor);
  const body = transaction.body();
  const outputs = body.outputs();

  try {
    for (const expected of planned) {
      const index = Number(expected.index);

      assert.ok(
        Number.isSafeInteger(index) && index >= 0 && index < outputs.len(),
        "missing protected output index",
      );

      const output = outputs.get(index);

      try {
        const actual = coreToTxOutput(output);
        const context = `protected ${expected.role} output ${index}`;

        assert.equal(
          actual.address,
          ledgerAddress(expected.address),
          `${context}: address changed`,
        );
        assert.deepEqual(
          actual.assets,
          ledgerValue(expected.value),
          `${context}: value changed; replan minimum-ADA reserves explicitly`,
        );
        assert.equal(
          actual.scriptRef ?? null,
          expected.referenceScript,
          `${context}: reference script changed`,
        );
        assert.equal(actual.datumHash ?? null, null, `${context}: unexpected datum hash`);

        if (expected.datum === null)
          assert.equal(actual.datum ?? null, null, `${context}: unexpected datum`);
        else {
          assert.ok(actual.datum, `${context}: missing inline datum`);
          assert.ok(
            equalData(decodeData(actual.datum), expected.datum),
            `${context}: datum changed`,
          );
        }
      } finally {
        output.free();
      }
    }
  } finally {
    outputs.free();
    body.free();
    transaction.free();
  }
}
