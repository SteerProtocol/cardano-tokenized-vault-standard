/** Ephemeral test signing stays outside the daemon; final bytes undergo existing wallet-effects approval. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertApprovedTransaction,
  verifyTransactionEffects,
  type WalletAuthorization,
} from "@ctvs/cardano";
import type { Deployment, TransactionPlan } from "@ctvs/planning";
import type { OutRef } from "@ctvs/protocol";
import {
  CML,
  Lucid,
  type LucidEvolution,
  type Provider,
  SLOT_CONFIG_NETWORK,
  type TxBuilder,
  type UTxO,
} from "@lucid-evolution/lucid";
import { asRef, protocolValue } from "../../../../../testing/ledger/serialization.js";
import { createProvider } from "../../../src/chain/kupo.js";
import { confirmedEvaluator, type EvaluationEvidence } from "../../support/evaluation.js";
import { type environment, eventually, write } from "./environment.js";

export async function wallet(env: ReturnType<typeof environment>) {
  SLOT_CONFIG_NETWORK.Custom = {
    zeroTime: Date.parse(env.genesis.systemStart),
    zeroSlot: 0,
    slotLength: env.genesis.slotLength * 1000,
  };

  const provider = createProvider(env.config);
  const evidence: EvaluationEvidence[] = [];

  provider.evaluateTx = confirmedEvaluator(provider, (entry) => {
    evidence.push(entry);
    write(env.directory, "confirmed-evaluations", evidence);
  });

  const lucid = await Lucid(provider, "Custom");
  const key = JSON.parse(
    readFileSync(join(env.directory, "genesis/utxo-keys/utxo1/utxo.skey"), "utf8"),
  );

  assert.equal(key.type, "GenesisUTxOSigningKey_ed25519");
  assert.match(key.cborHex, /^5820[a-f0-9]{64}$/);

  const privateKey = CML.PrivateKey.from_normal_bytes(Buffer.from(key.cborHex.slice(4), "hex"));

  const ownerKey = privateKey.to_bech32();

  try {
    lucid.selectWallet.fromPrivateKey(ownerKey);
  } finally {
    privateKey.free();
  }

  const parameters = await provider.getProtocolParameters();

  assert.equal(parameters.maxTxSize, 16384);
  assert.equal(parameters.maxTxExMem, 14000000n);
  assert.equal(parameters.maxTxExSteps, 10000000000n);
  write(env.directory, "provider-protocol-parameters", parameters);

  return {
    lucid,
    provider,
    parameters,
    selectOwner: () => lucid.selectWallet.fromPrivateKey(ownerKey),
  };
}

export async function authorize(
  lucid: LucidEvolution,
  provider: Provider,
  deployment: Deployment,
  plan: TransactionPlan,
  reference: UTxO,
): Promise<WalletAuthorization> {
  const resolved = (utxo: UTxO) => ({
    ref: asRef(utxo),
    address: utxo.address,
    value: protocolValue(utxo.assets),
    referenceScript: utxo.scriptRef ?? null,
  });

  const lookup = async (ref: OutRef) => {
    const found = (
      await provider.getUtxosByOutRef([{ txHash: ref.txId, outputIndex: Number(ref.index) }])
    )[0];

    assert.ok(found);

    return resolved(found);
  };

  const funds = (await lucid.wallet().getUtxos()).map(resolved);
  const slots = lucid.config().slotConfig;

  assert.ok(slots);

  return {
    networkId: 0,
    networkName: deployment.network,
    networkDomain: deployment.networkDomain,
    planInputs: await Promise.all(plan.inputs.map((input) => lookup(input.ref))),
    allowedFundingInputs: funds,
    allowedCollateralInputs: funds,
    allowedReferenceInputs: [
      resolved(reference),
      ...(await Promise.all(plan.referenceInputs.map(lookup))),
    ],
    change: { address: await lucid.wallet().address(), datum: { kind: "none" } },
    maxNetworkFee: 5000000n,
    maxCollateralExposure: 10000000n,
    permittedExtraOutputs: [],
    additionalRequiredSigners: [],
    validitySlots: plan.validity
      ? {
          lower: BigInt(lucid.unixTimeToSlot(Number(plan.validity.lowerPosixMs))),
          upper: BigInt(lucid.unixTimeToSlot(Number(plan.validity.upperPosixMs))),
        }
      : { lower: null, upper: null },
    slotConfig: {
      zeroTime: BigInt(slots.zeroTime),
      zeroSlot: BigInt(slots.zeroSlot),
      slotLength: BigInt(slots.slotLength),
    },
  };
}

export async function submit(
  directory: string,
  stage: string,
  builder: TxBuilder,
  provider: Provider,
  approved?: { plan: TransactionPlan; authorization: WalletAuthorization },
) {
  const built = await builder.complete({ localUPLCEval: false });
  const approval = approved
    ? verifyTransactionEffects(built.toCBOR(), approved.plan, approved.authorization)
    : null;
  const signed = await built.sign.withWallet().complete();
  const signedCbor = signed.toCBOR(),
    txId = signed.toHash();

  if (approval) assertApprovedTransaction(signedCbor, approval);

  const evaluations = hasRedeemers(signedCbor) ? await provider.evaluateTx(signedCbor) : [];
  const record = {
    stage,
    txId,
    signedCbor,
    bytes: signedCbor.length / 2,
    evaluations,
    approval,
    nodeAccepted: false,
  };

  write(directory, `${stage}-candidate`, record);
  assert.equal(await signed.submit(), txId);
  await eventually(async () => {
    const outputs = await provider.getUtxosByOutRef([{ txHash: txId, outputIndex: 0 }]);

    return outputs.length ? outputs : undefined;
  }, `${stage} indexed inclusion`);
  write(directory, stage, { ...record, indexed: true });

  return record;
}

function hasRedeemers(cbor: string): boolean {
  const tx = CML.Transaction.from_cbor_hex(cbor);
  const witnesses = tx.witness_set();
  const redeemers = witnesses.redeemers();

  try {
    return redeemers !== undefined;
  } finally {
    redeemers?.free();
    witnesses.free();
    tx.free();
  }
}
