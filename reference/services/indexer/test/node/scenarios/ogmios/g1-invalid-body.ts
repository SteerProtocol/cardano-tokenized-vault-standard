/** Explicit collateral-only ledger intent uses generated keys and preserves all ordinary input purposes. */
import assert from "node:assert/strict";
import {
  assetsToValue,
  CML,
  coreToTxOutput,
  type UTxO,
  withCMLScope,
} from "@lucid-evolution/lucid";

export function collateralBody(cbor: string, source: UTxO, destination: string) {
  return withCMLScope((own) => {
    const tx = own(CML.Transaction.from_cbor_hex(cbor));
    const old = own(tx.body());
    const outputs = own(old.outputs());
    const replacement = own(CML.TransactionOutputList.new());

    assert.equal(old.mint(), undefined);
    assert.equal(old.certs(), undefined);
    assert.equal(old.withdrawals(), undefined);

    for (let index = 0; index < outputs.len(); index++) {
      const output = own(outputs.get(index));

      if (index === outputs.len() - 1) {
        const parsed = coreToTxOutput(output);

        assert.equal(parsed.address, source.address);
        assert.equal(parsed.datum, undefined);
        output.set_amount(
          own(
            assetsToValue({ ...parsed.assets, lovelace: (parsed.assets.lovelace ?? 0n) - 100000n }),
          ),
        );
      }

      replacement.add(output);
    }

    const body = own(CML.TransactionBody.new(own(old.inputs()), replacement, old.fee() + 100000n));
    const references = old.reference_inputs();
    const signers = old.required_signers();
    const hash = old.script_data_hash();

    if (references) body.set_reference_inputs(own(references));

    if (signers) body.set_required_signers(own(signers));

    if (hash) body.set_script_data_hash(own(hash));

    const upper = old.ttl();
    const lower = old.validity_interval_start();

    if (upper !== undefined) body.set_ttl(upper);

    if (lower !== undefined) body.set_validity_interval_start(lower);

    const inputs = own(CML.TransactionInputList.new());

    inputs.add(
      own(
        CML.TransactionInput.new(
          own(CML.TransactionHash.from_hex(source.txHash)),
          BigInt(source.outputIndex),
        ),
      ),
    );
    body.set_collateral_inputs(inputs);
    body.set_total_collateral(5000000n);
    body.set_collateral_return(
      own(
        CML.TransactionOutput.new(
          own(CML.Address.from_bech32(destination)),
          own(
            assetsToValue({
              ...source.assets,
              lovelace: (source.assets.lovelace ?? 0n) - 5000000n,
            }),
          ),
        ),
      ),
    );

    const witnesses = own(CML.TransactionWitnessSet.new());
    const original = own(tx.witness_set());
    const redeemers = original.redeemers();

    assert.ok(redeemers);
    witnesses.set_redeemers(own(redeemers));

    return own(CML.Transaction.new(body, witnesses, true)).to_cbor_hex();
  });
}

export function scriptInvalid(cbor: string) {
  return withCMLScope((own) => {
    const tx = own(CML.Transaction.from_cbor_hex(cbor));

    return own(CML.Transaction.new(own(tx.body()), own(tx.witness_set()), false)).to_cbor_hex();
  });
}
