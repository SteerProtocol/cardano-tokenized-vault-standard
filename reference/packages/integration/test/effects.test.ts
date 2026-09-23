/** Checks that wallet-effect approvals remain bound to indexed deployment identity, chain point and protected inputs. */
import {
  type ResolvedEffectInput,
  verifyTransactionEffects,
  type WalletAuthorization,
} from "@ctvs/cardano";
import { buildRefundPlan, buildRequestPlan } from "@ctvs/ctvs2";
import { output, type TransactionPlan, type Value } from "@ctvs/planning";
import { assetId, encodeData, hex, type OutRef, outRefData, refId } from "@ctvs/protocol";
import { applyParamsToScript, CML, Data, withCMLScope } from "@lucid-evolution/lucid";
import { describe, expect, it } from "vitest";
import { ledgerAddress } from "../../../testing/ledger/serialization.js";
import { readAcceptedTransaction } from "../src/index.js";
import { encodePlan, inputAt, readerFixture, seed } from "./fixtures.js";

const fee = 1_000_000n;

/**
 * Extend the synthetic plan with explicit funding/change and the body fields needed
 * by wallet review. Placeholder script-data hash and synthetic acceptance isolate
 * effect/provenance checks; neither signatures nor ledger validity follow from this
 * helper's successful construction.
 */
function constructed(
  f: ReturnType<typeof readerFixture>,
  plan: TransactionPlan,
  funding: ResolvedEffectInput,
  change: Value,
): string {
  const payment = output("receiver", { address: f.owner, datum: null }, change);
  const skeleton = encodePlan({
    ...plan,
    inputs: [...plan.inputs, { ref: funding.ref, role: "genesis_seed", redeemer: null }],
    outputs: [...plan.outputs, { ...payment, index: BigInt(plan.outputs.length) }],
  });

  return withCMLScope((own) => {
    const tx = own(CML.Transaction.from_cbor_hex(skeleton)),
      body = own(tx.body()),
      witnesses = own(tx.witness_set());

    const refs = (values: readonly OutRef[]) => {
      const list = own(CML.TransactionInputList.new());

      for (const ref of values)
        list.add(
          own(CML.TransactionInput.new(own(CML.TransactionHash.from_hex(ref.txId)), ref.index)),
        );

      return list;
    };

    if (plan.referenceInputs.length) body.set_reference_inputs(refs(plan.referenceInputs));

    if (plan.requiredSigners.length) {
      const signers = own(CML.Ed25519KeyHashList.new());

      for (const key of plan.requiredSigners) signers.add(own(CML.Ed25519KeyHash.from_hex(key)));

      body.set_required_signers(signers);
    }

    if (plan.validity) {
      body.set_validity_interval_start(plan.validity.lowerPosixMs);
      body.set_ttl(plan.validity.upperPosixMs);
    }

    if (plan.inputs.some((input) => input.redeemer !== null)) {
      const program = applyParamsToScript(f.reviewed.vaultTemplate, [
        Data.from<Data>(hex(encodeData(outRefData(seed)))),
        plan.implementation.termsHash,
      ]);
      const scripts = own(CML.PlutusV3ScriptList.new());

      scripts.add(own(CML.PlutusV3Script.from_cbor_hex(program)));
      witnesses.set_plutus_v3_scripts(scripts);
      // The effect checker binds this field; a ledger evaluator checks its contents.
      body.set_script_data_hash(own(CML.ScriptDataHash.from_hex("00".repeat(32))));
    }

    return own(CML.Transaction.new(body, witnesses, true)).to_cbor_hex();
  });
}

function requestEffectsFixture() {
  const f = readerFixture();
  const underlying = assetId(f.reader.context(f.policy).terms.underlying);
  const fundingValue: Value = { ada: 10_000_000n };

  fundingValue[underlying] = (fundingValue[underlying] ?? 0n) + 202_000n;

  const fundingPlan: TransactionPlan = {
    ...f.plan,
    inputs: [],
    mint: [],
    outputs: [
      { ...output("receiver", { address: f.owner, datum: null }, fundingValue), index: 0n },
    ],
  };
  const fundingCreation = f.append(fundingPlan);
  const funding: ResolvedEffectInput = {
    ref: { txId: fundingCreation.tx.id, index: 0n },
    address: ledgerAddress(f.owner),
    value: fundingValue,
    referenceScript: null,
  };
  const context = f.reader.context(f.policy);

  if (context.deployment.family !== "ctvs2") throw new Error("wrong fixture family");

  const plan = buildRequestPlan({
    ...context,
    deployment: context.deployment,
    request: {
      recovery: {
        vaultPolicy: f.policy,
        controller: f.owner.payment.hash,
        refund: { address: f.owner, datum: null },
        deadlinePosixMs: 100_000n,
      },
      body: {
        termsHash: context.deployment.termsHash,
        kind: "deposit",
        offered: 101_000n,
        minimumOutput: 100_000n,
        receiver: { address: f.owner, datum: null },
        storageLovelace: 3_000_000n,
        executionBudget: 500_000n,
        settlerFee: 100_000n,
      },
    },
  });
  const config = f.genesis.tx.outputs[0],
    request = plan.outputs[0];

  if (!config || !request) throw new Error("missing fixture output");

  const auth: WalletAuthorization = {
    networkId: f.network.networkId,
    networkName: f.network.name,
    networkDomain: f.network.domain,
    planInputs: [],
    allowedFundingInputs: [funding],
    allowedCollateralInputs: [],
    allowedReferenceInputs: [
      { ref: config.ref, address: config.address, value: config.value, referenceScript: null },
    ],
    change: { address: funding.address, datum: { kind: "none" } },
    maxNetworkFee: fee,
    maxCollateralExposure: 0n,
    permittedExtraOutputs: [],
    additionalRequiredSigners: [],
    validitySlots: { lower: null, upper: null },
    slotConfig: { zeroTime: 0n, zeroSlot: 0n, slotLength: 1n },
  };
  const change: Value = { ...funding.value, ada: (funding.value.ada ?? 0n) - fee };

  for (const [unit, quantity] of Object.entries(request.value))
    change[unit] = (change[unit] ?? 0n) - quantity;

  const cbor = constructed(f, plan, funding, change);

  return { f, plan, auth, cbor };
}

describe("authenticated constructed effects", () => {
  it("returns request creation effects bound to the indexed vault, build, network and chain point", () => {
    const { f, plan, auth, cbor } = requestEffectsFixture();
    const result = f.reader.effects(f.policy.toUpperCase(), cbor, plan, auth);

    expect(result.kind).toBe("constructed_effects");
    expect(result.chainPoint).toEqual(f.reader.chainPoint);
    expect(result.implementation).toEqual({
      family: "ctvs2",
      buildId: f.reviewed.buildId,
      profile: 0,
      wire: 2,
    });
    expect(result.evidence.termsHash).toBe(plan.implementation.termsHash);
    expect(result.verification.independentLedgerValidation).toBe(false);
    expect(result.data.fee).toBe(fee);
    expect(result.data.effects.inputs).toMatchObject(
      auth.allowedFundingInputs.map((input) => ({ ref: refId(input.ref), role: "funding" })),
    );
    expect(result.data.effects.referenceInputs).toEqual(plan.referenceInputs.map(refId));
    expect(result.data.effects.outputs.map((item) => item.role)).toEqual(["protected", "change"]);
    expect(result.data.effects.mint).toEqual({});
  });

  it.each([
    ["build", { buildId: "unreviewed-build" }],
    ["Terms", { termsHash: "ee".repeat(32) }],
    ["family", { family: "ctvs1" as const }],
    ["Config script", { configLock: "ee".repeat(28) }],
    ["Claim script", { claimScript: "ee".repeat(28) }],
  ])(
    "rejects an otherwise verifiable transaction paired with a different %s identity",
    (_, changed) => {
      const { f, plan, auth, cbor } = requestEffectsFixture();
      const altered = { ...plan, implementation: { ...plan.implementation, ...changed } };

      // CBOR effect equality alone cannot establish which reviewed deployment produced an intent.
      expect(() => verifyTransactionEffects(cbor, altered, auth)).not.toThrow();
      expect(() => f.reader.effects(f.policy, cbor, altered, auth)).toThrow(
        /construction|deployment|identity|build/,
      );
    },
  );

  it("rejects a previously current plan after the accepted chain advances", () => {
    const { f, plan, auth, cbor } = requestEffectsFixture();

    f.reader.rollForward(f.block([]));
    expect(() => f.reader.effects(f.policy, cbor, plan, auth)).toThrow(/stale|chain point/);
  });

  it("rejects substituted resolved Request value even when the claimed effects balance", () => {
    const { f, plan: creation, auth: creationAuth, cbor: creationCbor } = requestEffectsFixture();

    f.reader.rollForward(f.block([creationCbor]));

    const created = readAcceptedTransaction(creationCbor),
      change = created.outputs[1];

    if (!change) throw new Error("missing funding change");

    const context = f.reader.context(f.policy);

    if (context.deployment.family !== "ctvs2") throw new Error("wrong fixture family");

    const source = inputAt(creation, created.id, 0);
    const plan = buildRefundPlan({
      deployment: context.deployment,
      source,
      mode: "cancel",
      validity: { lowerPosixMs: 1n, upperPosixMs: 90_000n },
    });
    const funding = {
      ref: change.ref,
      address: change.address,
      value: change.value,
      referenceScript: null,
    };
    const resolved = {
      ref: source.ref,
      address: ledgerAddress(source.address),
      value: source.value,
      referenceScript: null,
    };
    const auth: WalletAuthorization = {
      ...creationAuth,
      planInputs: [resolved],
      allowedFundingInputs: [funding],
      allowedReferenceInputs: [],
      validitySlots: { lower: 1n, upper: 90_000n },
    };
    const availableChange = { ...funding.value, ada: (funding.value.ada ?? 0n) - fee };
    const cbor = constructed(f, plan, funding, availableChange);

    expect(() => f.reader.effects(f.policy, cbor, plan, auth)).not.toThrow();

    // Keep altered CBOR balanced against fabricated evidence: only the indexed origin exposes the substitution.
    const substituted = {
      ...auth,
      planInputs: [
        { ...resolved, value: { ...resolved.value, ada: (resolved.value.ada ?? 0n) + 1n } },
      ],
    };
    const altered = constructed(f, plan, funding, {
      ...availableChange,
      ada: availableChange.ada + 1n,
    });

    expect(() => verifyTransactionEffects(altered, plan, substituted)).not.toThrow();
    expect(() => f.reader.effects(f.policy, altered, plan, substituted)).toThrow(
      /resolved|indexed|accepted|input evidence|value/,
    );
  });
});
