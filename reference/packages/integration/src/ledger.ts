/** Interprets accepted transaction CBOR for projection, including collateral-only effects after phase-two failure. */
import { protocolRef, protocolValue } from "@ctvs/cardano";
import type { ProtectedInput } from "@ctvs/planning";
import { decodeData, refId } from "@ctvs/protocol";
import {
  CML,
  coreToOutRef,
  coreToTxOutput,
  getAddressDetails,
  withCMLScope,
} from "@lucid-evolution/lucid";
import type { AcceptedTransaction, LedgerOutput } from "./types.js";

/**
 * Decode a complete transaction supplied by an accepted-block feed into effective
 * UTxO changes and Spend redeemers keyed by canonical input identity. Phase-two-invalid
 * bodies contribute only collateral inputs/return, never ordinary State transitions.
 * Malformed CBOR or inconsistent spend pointers throw. All returned values are plain
 * data; CML handles are released before returning, and acceptance is not proved here.
 */
export function readAcceptedTransaction(cbor: string): AcceptedTransaction {
  return withCMLScope((own) => {
    const tx = own(CML.Transaction.from_cbor_hex(cbor));
    const body = own(tx.body());
    const id = own(CML.hash_transaction(body)).to_hex();

    const refs = (list: CML.TransactionInputList | undefined) => {
      if (!list) return [];

      own(list);

      return Array.from({ length: list.len() }, (_, index) =>
        protocolRef(coreToOutRef(own(list.get(index)))),
      );
    };

    // Spend pointers index canonical TxIn order, independent of the CBOR list's serialized order.
    const ordinaryInputs = refs(body.inputs()).sort(
      (a, b) =>
        a.txId.localeCompare(b.txId) || (a.index < b.index ? -1 : a.index > b.index ? 1 : 0),
    );
    const inputs = tx.is_valid() ? ordinaryInputs : refs(body.collateral_inputs());
    const ordinary = own(body.outputs());
    const outputs: LedgerOutput[] = [];

    const add = (output: CML.TransactionOutput, index: bigint) => {
      const parsed = coreToTxOutput(own(output));

      outputs.push({ ...parsed, ref: { txId: id, index }, value: protocolValue(parsed.assets) });
    };

    if (tx.is_valid()) {
      for (let index = 0; index < ordinary.len(); index++) add(ordinary.get(index), BigInt(index));
    } else {
      const collateralReturn = body.collateral_return();

      // CIP-40 places the return after ordinary indices, although ordinary outputs are not created on failure.
      if (collateralReturn) add(collateralReturn, BigInt(ordinary.len()));
    }

    const spends = new Map<string, string>();
    const witnesses = own(tx.witness_set());
    const redeemers = own(witnesses.redeemers());

    // Redeemers in a failed transaction describe unsuccessful intent, not consumed script inputs.
    if (tx.is_valid() && redeemers) {
      const flat = own(redeemers.to_flat_format());

      for (let i = 0; i < flat.len(); i++) {
        const redeemer = own(flat.get(i));

        if (redeemer.tag() !== CML.RedeemerTag.Spend) continue;

        const input = ordinaryInputs[Number(redeemer.index())];

        if (!input) throw new Error("spend redeemer index exceeds inputs");

        const key = refId(input);

        if (spends.has(key)) throw new Error("duplicate spending redeemer");

        spends.set(key, own(redeemer.data()).to_cbor_hex());
      }
    }

    return {
      id,
      valid: tx.is_valid(),
      inputs,
      outputs,
      spends,
      referenceInputs: refs(body.reference_inputs()),
    };
  });
}

/**
 * Require the exact network and enterprise script custody form with an inline datum
 * and no reference script. Return planner metadata without interpreting datum contents,
 * allowing recovery to inspect its stable envelope independently of opaque economics.
 * This neither authenticates output origin nor verifies datum/value semantics; the
 * caller must establish those for the operation being performed.
 */
export function protectedMetadata(
  source: LedgerOutput,
  script: string,
  networkId: number,
): Omit<ProtectedInput, "datum"> {
  const details = getAddressDetails(source.address);

  if (
    details.networkId !== networkId ||
    details.type !== "Enterprise" ||
    details.paymentCredential?.type !== "Script" ||
    details.paymentCredential.hash !== script ||
    !source.datum ||
    source.datumHash ||
    source.scriptRef
  )
    throw new Error(
      "protected output requires exact enterprise script address, inline datum, and no reference script",
    );

  return {
    ref: source.ref,
    address: { payment: { type: "script", hash: script }, stake: null },
    datumMode: "inline",
    referenceScript: null,
    value: source.value,
  };
}

/**
 * Add full Plutus Data decoding to the same protected-custody checks. Use this for
 * Config, State or Claim paths that require understood data; malformed or unsupported
 * data throws. Recovery paths should use protectedMetadata and retain original CBOR.
 */
export function protectedOutput(
  source: LedgerOutput,
  script: string,
  networkId: number,
): ProtectedInput {
  const metadata = protectedMetadata(source, script, networkId);

  return { ...metadata, datum: decodeData(source.datum ?? "") };
}
