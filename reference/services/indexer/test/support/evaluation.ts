/** Node-only evaluation uses actual ledger inputs after checking all supplemental construction evidence. */
import {
  CML,
  type Provider,
  type UTxO,
  utxoToTransactionOutput,
  withCMLScope,
} from "@lucid-evolution/lucid";

export interface EvaluationEvidence {
  txId: string;
  source: "node_ledger";
  confirmedRefs: string[];
  redeemers: number;
}

const id = (utxo: UTxO) => `${utxo.txHash}#${utxo.outputIndex}`;

const output = (utxo: UTxO) =>
  withCMLScope((own) => own(utxoToTransactionOutput(utxo)).to_cbor_hex());

/** Kupmios cannot encode supplemental JSON quantities above 2^53. Confirmed inputs need no overrides. */
export function confirmedEvaluator(
  provider: Pick<Provider, "evaluateTx" | "getUtxosByOutRef">,
  record: (evidence: EvaluationEvidence) => void,
): Provider["evaluateTx"] {
  const evaluate = provider.evaluateTx.bind(provider);

  return async (cbor, supplemental = []) => {
    if (supplemental.length) {
      const confirmed = await provider.getUtxosByOutRef(
        supplemental.map(({ txHash, outputIndex }) => ({ txHash, outputIndex })),
      );
      const byId = new Map(confirmed.map((utxo) => [id(utxo), utxo]));

      for (const supplied of supplemental) {
        const actual = byId.get(id(supplied));

        if (!actual || output(actual) !== output(supplied))
          throw new Error(`Evaluation requires matching confirmed input ${id(supplied)}`);
      }
    }

    const result = await evaluate(cbor);
    const txId = withCMLScope((own) => {
      const tx = own(CML.Transaction.from_cbor_hex(cbor));
      const body = own(tx.body());

      return own(CML.hash_transaction(body)).to_hex();
    });

    record({
      txId,
      source: "node_ledger",
      confirmedRefs: supplemental.map(id),
      redeemers: result.length,
    });

    return result;
  };
}
