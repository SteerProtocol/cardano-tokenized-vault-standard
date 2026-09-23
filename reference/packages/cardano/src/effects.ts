/** Checks constructed and signed transactions against wallet-approved CTVS intent and resolved UTxOs. */
import { type TransactionPlan, type Value, validatePlan } from "@ctvs/planning";
import { refId } from "@ctvs/protocol";
import { CML, withCMLScope } from "@lucid-evolution/lucid";
import {
  addressInfo,
  addValue,
  check,
  nonKeyWitnessCbor,
  plannedAddress,
  plannedDatum,
  readMint,
  readOutput,
  readRefs,
  sameDatum,
  sameOutput,
  sameValue,
} from "./effects-ledger.js";
import type {
  AuthorizedOutput,
  ResolvedEffectInput,
  TransactionApproval,
  VerifiedTransactionEffects,
  WalletAuthorization,
} from "./effects-types.js";

import { verifyWitnesses } from "./effects-witnesses.js";
import { normalizedValue } from "./ledger.js";

export type * from "./effects-types.js";

/**
 * Index one authorization category by validated output reference without cloning
 * its evidence. Reject duplicate identities, wrong-network addresses and negative
 * custody quantities before selection; funding/collateral also require key control.
 */
function inputMap(
  values: readonly ResolvedEffectInput[],
  networkId: number,
  keyOnly: boolean,
): Map<string, ResolvedEffectInput> {
  const result = new Map<string, ResolvedEffectInput>();

  for (const value of values) {
    const id = refId(value.ref);

    check(!result.has(id), "duplicate authorized input");

    const address = addressInfo(value.address, networkId);

    if (keyOnly)
      check(address.key !== null, "wallet funding and collateral must use key payment credentials");

    check(
      Object.values(normalizedValue(value.value)).every((quantity) => quantity >= 0n),
      "negative resolved input value",
    );
    result.set(id, value);
  }

  return result;
}

/**
 * Resolve actual spends exclusively against the plan and wallet allowlists.
 * Every planned spend/reference must be present, while additional references must
 * be authorized and disjoint from spends/collateral. Return plain review records,
 * an input-value accumulator and key requirements for later conservation/signing
 * checks. Collateral evidence is deliberately checked as a separate failure path.
 */
function resolveAuthorizedInputs(
  body: CML.TransactionBody,
  plan: TransactionPlan | null,
  auth: WalletAuthorization,
) {
  const sources = inputMap(auth.planInputs, auth.networkId, false),
    funding = inputMap(auth.allowedFundingInputs, auth.networkId, true),
    collateral = inputMap(auth.allowedCollateralInputs, auth.networkId, true),
    references = inputMap(auth.allowedReferenceInputs, auth.networkId, false);
  const inputRefs = readRefs(body.inputs()),
    referenceRefs = readRefs(body.reference_inputs()),
    collateralRefs = readRefs(body.collateral_inputs());
  const wanted = new Set((plan?.inputs ?? []).map((input) => refId(input.ref)));

  check(
    sources.size === wanted.size && [...sources.keys()].every((id) => wanted.has(id)),
    "resolved plan inputs do not match plan",
  );

  for (const id of wanted) check(inputRefs.includes(id), "missing planned input");

  for (const id of referenceRefs)
    check(
      references.has(id) && !inputRefs.includes(id) && !collateralRefs.includes(id),
      "unapproved or overlapping reference input",
    );

  for (const reference of plan?.referenceInputs ?? [])
    check(referenceRefs.includes(refId(reference)), "missing planned reference input");

  const sum: Value = {},
    requiredKeys = new Set<string>(),
    resolved = new Map<string, ResolvedEffectInput>(),
    selectedFunding: string[] = [];
  const inputs: VerifiedTransactionEffects["inputs"] = [];

  for (const id of inputRefs) {
    const input = sources.get(id) ?? funding.get(id);

    check(input, "unapproved funding input");

    let role: "plan" | "funding" = "plan";

    if (!wanted.has(id)) {
      selectedFunding.push(id);
      role = "funding";
    }

    resolved.set(id, input);
    addValue(sum, input.value);

    const key = addressInfo(input.address, auth.networkId).key;

    if (key) requiredKeys.add(key);

    inputs.push({
      ref: id,
      role,
      address: input.address,
      value: { ...input.value },
    });
  }

  return {
    collateral,
    references,
    inputRefs,
    referenceRefs,
    collateralRefs,
    sum,
    requiredKeys,
    resolved,
    selectedFunding,
    inputs,
  };
}

/**
 * Validate each selected collateral source and add its payment key to the required
 * signature set. A consumed funding UTxO may also be collateral, provided both
 * authorizations describe the same address and value. Its value is not added to
 * ordinary spend conservation again; net failure-path exposure is checked later.
 */
function verifyCollateralEvidence(
  refs: string[],
  allowed: Map<string, ResolvedEffectInput>,
  resolved: Map<string, ResolvedEffectInput>,
  requiredKeys: Set<string>,
  networkId: number,
): void {
  for (const id of refs) {
    const input = allowed.get(id);

    check(input, "unapproved collateral input");

    const alsoSpent = resolved.get(id);

    if (alsoSpent)
      check(
        sameValue(alsoSpent.value, input.value) && alsoSpent.address === input.address,
        "inconsistent overlapping collateral evidence",
      );

    const key = addressInfo(input.address, networkId).key;

    check(key, "script collateral is prohibited");
    requiredKeys.add(key);
  }
}

/**
 * Reject internally contradictory review policy before interpreting candidate CBOR.
 * A supplied plan must remain an unsigned intent and match the authorization's
 * network identity. A null plan skips those plan bindings, not the wallet's budget,
 * key-change, allowed-input or output restrictions.
 */
function verifyWalletAuthorization(plan: TransactionPlan | null, auth: WalletAuthorization): void {
  if (plan) validatePlan(plan);

  check(auth.networkId === 0 || auth.networkId === 1, "unsupported network ID");
  check(auth.maxNetworkFee >= 0n && auth.maxCollateralExposure >= 0n, "negative wallet budget");
  check(
    addressInfo(auth.change.address, auth.networkId).key !== null,
    "change must return to a key payment credential",
  );

  if (plan)
    check(
      plan.network.name === auth.networkName &&
        plan.network.domain.toLowerCase() === auth.networkDomain.toLowerCase(),
      "plan network does not match wallet authorization",
    );
}

/**
 * Close the unsupported body-effect surface: metadata, certificates, withdrawals
 * and governance fields are rejected on presence, even if empty or zero-valued.
 * This keeps the supported input/mint/output/fee equation complete for wallet review.
 * Borrow body/transaction handles and release only the fields obtained here.
 */
function rejectPurposeFields(body: CML.TransactionBody, transaction: CML.Transaction): void {
  withCMLScope((own) => {
    const unsupported = [
      body.certs(),
      body.withdrawals(),
      body.voting_procedures(),
      body.proposal_procedures(),
      body.auxiliary_data_hash(),
      transaction.auxiliary_data(),
    ].filter((field) => field !== undefined);

    for (const field of unsupported) own(field);

    check(
      unsupported.length === 0 &&
        body.donation() === undefined &&
        body.current_treasury_value() === undefined,
      "unapproved auxiliary data, certificates, withdrawals or governance fields",
    );
  });
}

/**
 * Match the body's validity slots exactly to prior wallet authorization. When the
 * plan carries POSIX bounds, map those authorized slots with the supplied network
 * configuration and require an interval contained inside the plan's bounds.
 * This does not check the current chain time or establish that inclusion is possible.
 */
function verifyValidity(
  body: CML.TransactionBody,
  plan: TransactionPlan | null,
  auth: WalletAuthorization,
): void {
  const { lower, upper } = auth.validitySlots;

  check(lower === null || lower >= 0n, "negative validity lower bound");
  check(upper === null || upper >= 0n, "negative validity upper bound");
  check(lower === null || upper === null || lower < upper, "empty validity interval");
  check(
    (body.validity_interval_start() ?? null) === lower && (body.ttl() ?? null) === upper,
    "validity slots changed",
  );

  if (plan?.validity) {
    const { zeroTime, zeroSlot, slotLength } = auth.slotConfig;

    check(slotLength > 0n && zeroSlot >= 0n, "invalid slot configuration");

    // Unaligned POSIX bounds may be rounded inward, never widened by slot conversion.
    const time = (slot: bigint): bigint => zeroTime + (slot - zeroSlot) * slotLength;

    check(
      lower !== null &&
        upper !== null &&
        time(lower) >= plan.validity.lowerPosixMs &&
        time(upper) <= plan.validity.upperPosixMs,
      "authorized slots do not match plan POSIX bounds",
    );
  }
}

/**
 * Read the explicit required_signers field as a sorted, duplicate-free set.
 * This field is distinct from signatures already present in the witness set and
 * from keys implicitly required by spending or collateral inputs.
 */
function requiredSigners(body: CML.TransactionBody): string[] {
  return withCMLScope((own) => {
    const list = body.required_signers();

    if (!list) return [];

    own(list);

    const result: string[] = [];

    for (let i = 0; i < list.len(); i++) result.push(own(list.get(i)).to_hex());

    check(new Set(result).size === result.length, "duplicate required signer");

    return result.sort();
  });
}

/**
 * Require the body's signer set to equal the plan/wallet union, not merely contain
 * it. Add those hashes to input-derived signature requirements and return the
 * observed sorted body set. No signature is checked until post-signing review.
 */
function verifyRequiredSigners(
  body: CML.TransactionBody,
  plan: TransactionPlan | null,
  auth: WalletAuthorization,
  requiredKeys: Set<string>,
): string[] {
  const signers = requiredSigners(body),
    expectedSigners = [
      ...new Set(
        [...(plan?.requiredSigners ?? []), ...auth.additionalRequiredSigners].map((key) =>
          key.toLowerCase(),
        ),
      ),
    ].sort();

  check(
    expectedSigners.every((key) => /^[a-f\d]{56}$/.test(key)),
    "invalid authorized required signer",
  );
  check(signers.join() === expectedSigners.join(), "required signers changed");

  for (const key of signers) requiredKeys.add(key);

  return signers;
}

/**
 * Match the protected output prefix by index, then consume exact permitted-output
 * matches as a multiset; remaining outputs must return authorized change. Indices
 * bind redeemer allocations, so a balancer cannot reorder or pad protected outputs.
 * Return all observed outputs with their role, failing if any protected or permitted
 * obligation is missing. Global value conservation constrains change quantities.
 */
function verifyOutputs(
  body: CML.TransactionBody,
  plan: TransactionPlan | null,
  auth: WalletAuthorization,
): VerifiedTransactionEffects["outputs"] {
  return withCMLScope((own) => {
    const list = own(body.outputs()),
      result: VerifiedTransactionEffects["outputs"] = [],
      remaining = [...auth.permittedExtraOutputs];

    for (let index = 0; index < list.len(); index++) {
      const actual = readOutput(own(list.get(index))),
        planned = plan?.outputs[index];

      addressInfo(actual.address, auth.networkId);

      let role: "protected" | "permitted" | "change";

      if (planned) {
        const expected: AuthorizedOutput = {
          address: plannedAddress(planned.address, auth.networkId),
          value: planned.value,
          datum: plannedDatum(planned.datum),
          referenceScript: null,
        };

        check(
          sameOutput(actual, expected, auth.networkId),
          `protected output ${index} changed; replan minimum-ADA reserves explicitly`,
        );
        role = "protected";
      } else {
        const permitted = remaining.findIndex((expected) =>
          sameOutput(actual, expected, auth.networkId),
        );

        if (permitted >= 0) {
          remaining.splice(permitted, 1);
          role = "permitted";
        } else {
          check(
            addressInfo(actual.address, auth.networkId).bytes ===
              addressInfo(auth.change.address, auth.networkId).bytes &&
              sameDatum(actual.datum, auth.change.datum) &&
              actual.referenceScript === null,
            `unapproved output ${index}; expected authorized change`,
          );
          role = "change";
        }
      }

      result.push({ ...actual, index, role });
    }

    check(result.length >= (plan?.outputs.length ?? 0), "missing protected output");
    check(remaining.length === 0, "missing explicitly authorized output");

    return result;
  });
}

/**
 * Calculate net ADA exposure from selected collateral less its optional return.
 * Every native asset must return to the authorized change destination, and any
 * total_collateral field must agree with the computed exposure. Return that exposure
 * and observed return output without changing normal-spend accounting.
 * Ledger collateral percentage, minimum ADA and phase-one sufficiency are not checked.
 */
function verifyCollateral(
  body: CML.TransactionBody,
  refs: string[],
  allowed: Map<string, ResolvedEffectInput>,
  auth: WalletAuthorization,
): { exposure: bigint; returned: AuthorizedOutput | null } {
  return withCMLScope((own) => {
    const sum: Value = {};

    for (const ref of refs) {
      const input = allowed.get(ref);

      check(input, "unapproved collateral input");
      addValue(sum, input.value);
    }

    const output = body.collateral_return(),
      returned = output ? readOutput(own(output)) : null;

    if (returned) {
      check(
        addressInfo(returned.address, auth.networkId).bytes ===
          addressInfo(auth.change.address, auth.networkId).bytes &&
          sameDatum(returned.datum, auth.change.datum) &&
          returned.referenceScript === null,
        "collateral return is not authorized change",
      );
      addValue(sum, returned.value, -1n);
    }

    const exposure = sum.ada ?? 0n;

    check(
      Object.entries(sum).every(([asset, amount]) => asset === "ada" || amount === 0n),
      "collateral return must preserve every native asset",
    );
    check(
      exposure >= 0n && exposure <= auth.maxCollateralExposure,
      "collateral exposure exceeds wallet authorization",
    );

    if (refs.length === 0)
      check(
        returned === null && body.total_collateral() === undefined,
        "collateral fields without collateral inputs",
      );
    else if (returned !== null || body.total_collateral() !== undefined)
      check(
        body.total_collateral() === exposure,
        "total collateral does not equal net collateral exposure",
      );

    return { exposure, returned };
  });
}

/**
 * Review supported Conway transaction effects against a previously fixed wallet
 * policy and optional CTVS plan, returning the body/non-key witness binding for signing.
 * A null plan authorizes no planned spends, mint or redeemers; outputs must still
 * match permitted extras or change, and all input categories remain allowlisted.
 * Any unauthorized or inconsistent effect throws. Supplied UTxO/network evidence
 * remains trusted: this is not provenance, phase-one, script-data-hash correctness or Plutus validation.
 */
export function verifyTransactionEffects(
  cbor: string,
  plan: TransactionPlan | null,
  auth: WalletAuthorization,
): TransactionApproval {
  verifyWalletAuthorization(plan, auth);

  return withCMLScope((own) => {
    const tx = own(CML.Transaction.from_cbor_hex(cbor)),
      body = own(tx.body()),
      witnesses = own(tx.witness_set());

    check(tx.is_valid(), "refusing an invalid-script transaction");
    rejectPurposeFields(body, tx);

    const network = body.network_id();

    if (network)
      check(own(network).network() === BigInt(auth.networkId), "body network ID changed");

    verifyValidity(body, plan, auth);
    check(body.fee() <= auth.maxNetworkFee, "network fee exceeds wallet authorization");

    // Resolve authorized sources and failure-path collateral keys from caller-supplied evidence.
    const {
      collateral,
      references,
      inputRefs,
      referenceRefs,
      collateralRefs,
      sum,
      requiredKeys,
      resolved,
      selectedFunding,
      inputs,
    } = resolveAuthorizedInputs(body, plan, auth);

    verifyCollateralEvidence(collateralRefs, collateral, resolved, requiredKeys, auth.networkId);

    // Signed mint deltas are part of conservation, including burns; collateral is not.
    const actualMint = readMint(body.mint()),
      expectedMint: Value = {};

    for (const mint of plan?.mint ?? [])
      for (const [name, amount] of Object.entries(mint.assets))
        addValue(expectedMint, { [`${mint.policy}.${name}`]: amount });

    check(sameValue(actualMint.value, expectedMint), "mint quantities or policies changed");
    addValue(sum, actualMint.value);

    const signers = verifyRequiredSigners(body, plan, auth, requiredKeys);
    const redeemers = verifyWitnesses(
      witnesses,
      plan,
      inputRefs,
      actualMint.policies,
      resolved,
      references,
      referenceRefs,
      auth.networkId,
    );
    // Presence must agree with planned execution. The ledger must still validate the hash
    // against redeemers, datums and language views; approval only binds its chosen value.
    const scriptHash = body.script_data_hash();
    const scriptDataHash = scriptHash ? own(scriptHash).to_hex() : null;

    check(
      redeemers.length > 0 === (scriptDataHash !== null),
      "script-data hash presence does not match planned script execution",
    );

    // Match destinations before balancing the equation, so conservation cannot authorize a new payee.
    const outputs = verifyOutputs(body, plan, auth);

    for (const output of outputs) addValue(sum, output.value, -1n);

    addValue(sum, { ada: body.fee() }, -1n);
    check(sameValue(sum, {}), "resolved inputs, mint, outputs and fee do not conserve value");

    const { exposure, returned } = verifyCollateral(body, collateralRefs, collateral, auth);
    const effects: VerifiedTransactionEffects = {
      networkId: auth.networkId,
      networkName: auth.networkName,
      networkDomain: auth.networkDomain,
      inputs,
      referenceInputs: referenceRefs,
      outputs,
      mint: actualMint.value,
      requiredSigners: signers,
      validitySlots: { ...auth.validitySlots },
      collateralReturn: returned,
      collateralInputs: collateralRefs.map((ref) => {
        const input = collateral.get(ref);

        check(input, "unapproved collateral input");

        return { ref, address: input.address, value: { ...input.value } };
      }),
      redeemers,
      scriptDataHash,
    };

    // Retain the exact signing boundary. The effects object is review data, not deeply frozen state.
    return Object.freeze({
      bodyCbor: body.to_cbor_hex(),
      bodyHash: own(CML.hash_transaction(body)).to_hex(),
      nonKeyWitnessCbor: nonKeyWitnessCbor(witnesses),
      fee: body.fee(),
      collateralExposure: exposure,
      fundingInputs: Object.freeze(selectedFunding),
      collateralInputs: Object.freeze(collateralRefs),
      requiredWitnesses: Object.freeze([...requiredKeys].sort()),
      effects,
    });
  });
}

/**
 * Verify a signed candidate against an untouched approval from pre-signing review.
 * Body bytes/hash and canonical non-key witnesses must remain identical; every
 * supplied key signature must verify and every required payment/signer key must
 * be present. Extra valid key signatures are allowed. The check does not submit,
 * re-resolve UTxOs, re-evaluate scripts or prove that the transaction is still spendable.
 */
export function assertApprovedTransaction(signedCbor: string, approval: TransactionApproval): void {
  withCMLScope((own) => {
    const tx = own(CML.Transaction.from_cbor_hex(signedCbor)),
      body = own(tx.body()),
      witnesses = own(tx.witness_set());

    check(
      tx.is_valid() &&
        body.to_cbor_hex() === approval.bodyCbor &&
        own(CML.hash_transaction(body)).to_hex() === approval.bodyHash,
      "signed transaction body changed after approval",
    );
    rejectPurposeFields(body, tx);
    check(
      nonKeyWitnessCbor(witnesses) === approval.nonKeyWitnessCbor,
      "non-key witnesses changed after approval",
    );

    const keys = witnesses.vkeywitnesses(),
      present = new Set<string>();

    if (keys) {
      own(keys);

      for (let index = 0; index < keys.len(); index++) {
        const witness = own(keys.get(index)),
          key = own(witness.vkey()),
          signature = own(witness.ed25519_signature());

        check(
          key.verify(
            own(CML.TransactionHash.from_hex(approval.bodyHash)).to_raw_bytes(),
            signature,
          ),
          "invalid transaction signature",
        );
        present.add(own(key.hash()).to_hex());
      }
    }

    for (const key of approval.requiredWitnesses)
      check(present.has(key), "missing authorized input or required signer witness");
  });
}
