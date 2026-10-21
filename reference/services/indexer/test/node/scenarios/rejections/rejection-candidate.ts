/** Disposable adversarial construction bypasses planner/wallet guards so the real node must decide. */
import assert from "node:assert/strict";
import type { TransactionPlan } from "@ctvs/planning";
import {
  CML,
  type EvaluatorAdapter,
  fromCMLRedeemerTag,
  withCMLScope,
} from "@lucid-evolution/lucid";
import {
  datumHex,
  ledgerAddress,
  ledgerValue,
} from "../../../../../../testing/ledger/serialization.js";
import { write } from "../../support/environment.js";
import type { Flow } from "../../support/flow.js";
import { claimProgram } from "../../support/install.js";

/** This allocates construction budgets only. It performs no validation; actual Ogmios evaluation follows. */
export const negativeBudgets: EvaluatorAdapter = {
  name: "disposable-negative-budget-allocation-only",
  async evaluate({ tx }) {
    return withCMLScope((own) => {
      const transaction = own(CML.Transaction.from_cbor_hex(tx));
      const witnesses = own(transaction.witness_set());
      const optional = witnesses.redeemers();

      assert.ok(optional);

      const redeemers = own(own(optional).to_flat_format());

      assert.ok(redeemers.len() > 0 && redeemers.len() <= 4);

      return Array.from({ length: redeemers.len() }, (_, index) => {
        const row = own(redeemers.get(index));

        return {
          redeemer_tag: fromCMLRedeemerTag(row.tag()),
          redeemer_index: Number(row.index()),
          ex_units: { mem: 3300000, steps: 2300000000 },
        };
      });
    });
  },
};

/** Deliberately avoid validatePlan: malformed allocation lists must reach the compiled guard too. */
export async function negativeCandidate(
  f: Flow,
  label: string,
  plan: TransactionPlan,
  withdrawal?: string,
) {
  assert.equal(f.env.genesis.networkMagic, 42);
  assert.equal(plan.implementation.policy, f.installed.deployment.policy);

  const resolve = async (ref: { txId: string; index: bigint }) => {
    const [source] = await f.w.provider.getUtxosByOutRef([
      { txHash: ref.txId, outputIndex: Number(ref.index) },
    ]);

    assert.ok(source, "candidate must resolve every actual input");

    return source;
  };

  const references = await Promise.all(plan.referenceInputs.map(resolve));

  if (plan.mint.length || plan.inputs.some((input) => input.role !== "claim"))
    references.push(f.installed.reference);

  let builder = f.w.lucid.newTx();

  if (references.length) builder = builder.readFrom(references);

  for (const input of plan.inputs) {
    const source = await resolve(input.ref);

    assert.ok(input.redeemer);
    builder = builder.collectFrom([source], datumHex(input.redeemer));
  }

  if (plan.inputs.some((input) => input.role === "claim"))
    builder = builder.attach.SpendingValidator(claimProgram(f.env));

  for (const mint of plan.mint)
    builder = builder.mintAssets(
      Object.fromEntries(
        Object.entries(mint.assets).map(([name, amount]) => [mint.policy + name, amount]),
      ),
      datumHex(mint.redeemer),
    );

  for (const output of plan.outputs)
    builder =
      output.datum === null
        ? builder.pay.ToAddress(ledgerAddress(output.address), ledgerValue(output.value))
        : builder.pay.ToAddressWithData(
            ledgerAddress(output.address),
            { kind: "inline", value: datumHex(output.datum) },
            ledgerValue(output.value),
          );

  for (const signer of plan.requiredSigners) builder = builder.addSignerKey(signer);

  if (plan.validity)
    builder = builder
      .validFrom(Number(plan.validity.lowerPosixMs))
      .validTo(Number(plan.validity.upperPosixMs));

  if (withdrawal) builder = builder.withdraw(withdrawal, 0n);

  const built = await builder.complete({ localUPLCEval: true, evaluator: negativeBudgets });
  const signed = await built.sign.withWallet().complete();

  if (withdrawal)
    withCMLScope((own) => {
      const body = own(own(CML.Transaction.from_cbor_hex(signed.toCBOR())).body());
      const values = body.withdrawals();

      assert.ok(values);

      const withdrawals = own(values);
      const keys = own(withdrawals.keys());

      assert.equal(keys.len(), 1, "zero withdrawal must survive completion");
      assert.equal(withdrawals.get(own(keys.get(0))), 0n);
    });

  const candidate = {
    label,
    txId: signed.toHash(),
    signedCbor: signed.toCBOR(),
    plan,
    constructionValidation: false,
  };

  assert.ok(candidate.signedCbor.length / 2 <= f.w.parameters.maxTxSize);
  write(f.env.directory, `${label}-negative-candidate`, candidate);

  return candidate;
}

export type NegativeCandidate = Awaited<ReturnType<typeof negativeCandidate>>;
