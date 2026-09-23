/** Builds deterministic synthetic histories to isolate projection behavior from consensus and script execution. */
import { createGenesisPlan, type ProtectedInput, type TransactionPlan } from "@ctvs/planning";
import { encodeData, hex, type OutRef, outRefData, refId, termsHash } from "@ctvs/protocol";
import {
  applyParamsToScript,
  assetsToValue,
  CML,
  Data,
  validatorToScriptHash,
  withCMLScope,
} from "@lucid-evolution/lucid";
import { ledgerAddress, ledgerValue } from "../../../testing/ledger/serialization.js";
import { fixture } from "../../planning/test/fixtures.js";
import {
  type AcceptedBlock,
  type ReviewedBuild,
  readAcceptedTransaction,
  VaultReader,
} from "../src/index.js";

export const origin = { slot: 0n, blockHash: "00".repeat(32) };
export const build: ReviewedBuild = {
  family: "ctvs2",
  buildId: "synthetic-reader-fixture",
  vaultTemplate: "49480100002221200101",
  config: { type: "PlutusV3", script: "49480100002221200101" },
  claim: { type: "PlutusV3", script: "49480100002221200101" },
};
export const seed = { txId: "aa".repeat(32), index: 0n };

/**
 * Encode planned outputs and Spend redeemers as a CML skeleton for projection tests.
 * The supplied validity flag simulates an accepted feed's outcome; this helper does
 * not balance, sign or establish ledger acceptance. Tests needing real execution
 * belong to the signed integration suite rather than inferring it from this CBOR.
 */
export function encodePlan(plan: TransactionPlan, valid = true): string {
  return withCMLScope((own) => {
    const inputs = own(CML.TransactionInputList.new());
    const sorted = [...plan.inputs].sort(
      (a, b) => a.ref.txId.localeCompare(b.ref.txId) || Number(a.ref.index - b.ref.index),
    );

    for (const input of sorted)
      inputs.add(
        own(
          CML.TransactionInput.new(
            own(CML.TransactionHash.from_hex(input.ref.txId)),
            input.ref.index,
          ),
        ),
      );

    const outputs = own(CML.TransactionOutputList.new());

    for (const output of plan.outputs)
      outputs.add(
        own(
          CML.TransactionOutput.new(
            own(CML.Address.from_bech32(ledgerAddress(output.address))),
            own(assetsToValue(ledgerValue(output.value))),
            output.datum === null
              ? undefined
              : CML.DatumOption.new_datum(
                  own(CML.PlutusData.from_cbor_hex(hex(encodeData(output.datum)))),
                ),
          ),
        ),
      );

    const body = own(CML.TransactionBody.new(inputs, outputs, 1_000_000n));
    const witnesses = own(CML.TransactionWitnessSet.new());
    const redeemers = own(CML.LegacyRedeemerList.new());

    for (let index = 0; index < sorted.length; index++) {
      const input = sorted[index];

      if (input?.redeemer)
        redeemers.add(
          own(
            CML.LegacyRedeemer.new(
              CML.RedeemerTag.Spend,
              BigInt(index),
              own(CML.PlutusData.from_cbor_hex(hex(encodeData(input.redeemer)))),
              own(CML.ExUnits.new(1n, 1n)),
            ),
          ),
        );
    }

    if (redeemers.len())
      witnesses.set_redeemers(own(CML.Redeemers.new_arr_legacy_redeemer(redeemers)));

    return own(CML.Transaction.new(body, witnesses, valid)).to_cbor_hex();
  });
}

/**
 * Bind a synthetic reviewed template to deterministic genesis Terms and seed, then
 * start a reader with that origin already replayed. append creates ordered test
 * blocks and deliberately treats generated skeletons as accepted, isolating lineage
 * and rollback behavior from consensus. Each call owns its independent journal.
 */
export function readerFixture(family: "ctvs1" | "ctvs2" = "ctvs2") {
  const f = family === "ctvs1" ? fixture("ctvs1") : fixture("ctvs2");
  const reviewed = { ...build, family, claim: family === "ctvs2" ? build.claim : null };
  const policy = validatorToScriptHash({
    type: "PlutusV3",
    script: applyParamsToScript(reviewed.vaultTemplate, [
      Data.from<Data>(hex(encodeData(outRefData(seed)))),
      termsHash(f.terms),
    ]),
  });
  const deployment = {
    ...f.deployment,
    policy,
    configLock: validatorToScriptHash(reviewed.config),
    claimScript: family === "ctvs2" ? validatorToScriptHash(build.config) : null,
    chainPoint: origin,
  } as typeof f.deployment;
  const plan = createGenesisPlan(family, {
    deployment,
    terms: f.terms,
    seed,
    configReserve: 10_000_000n,
    stateReserve: 10_000_000n,
  });
  const network = {
    name: deployment.network,
    domain: f.terms.networkDomain,
    networkId: 0 as const,
    networkMagic: 42,
    genesisHash: "01".repeat(32),
  };
  const reader = new VaultReader(network, [reviewed], origin);
  let counter = 1;

  const block = (cbor: string[]): AcceptedBlock => ({
    parent: reader.chainPoint,
    point: {
      slot: reader.chainPoint.slot + 1n,
      blockHash: (counter++).toString(16).padStart(64, "0"),
    },
    transactions: cbor,
  });

  const append = (plan: TransactionPlan) => {
    const cbor = encodePlan(plan),
      next = block([cbor]);

    reader.rollForward(next);

    return { cbor, block: next, tx: readAcceptedTransaction(cbor) };
  };

  const genesis = append(plan);

  return {
    reader,
    plan,
    policy,
    network,
    reviewed,
    genesis,
    block,
    append,
    owner: f.terms.feeDestination.address,
  };
}

/**
 * Reuse a planned datum-bearing output as the next test operation's source. The caller
 * supplies the synthetic transaction ID; this creates fixture evidence, not a fresh
 * UTxO lookup or proof that the referenced output is unspent.
 */
export function inputAt(plan: TransactionPlan, txId: string, index: number): ProtectedInput {
  const output = plan.outputs[index];

  if (!output?.datum) throw new Error("missing test datum");

  return {
    ref: { txId, index: BigInt(index) },
    address: output.address,
    datum: output.datum,
    datumMode: "inline",
    referenceScript: null,
    value: output.value,
  };
}

export const id = (ref: OutRef) => refId(ref);
