/** Independently check accepted gross obligations, shared pricing input, custody and authorization. */
import assert from "node:assert/strict";
import type { BatchPlan } from "@ctvs/ctvs2";
import { readAcceptedTransaction, toPlannerInput } from "@ctvs/integration";
import { decodeData, NAMES, redeemerFromData, refId } from "@ctvs/protocol";
import { expect } from "vitest";
import { batchEvidence } from "../../../support/evidence/batch.js";
import { stateCustody, underlyingValue } from "../../support/assets.js";
import { type Flow, type Receipt, readback } from "../../support/flow.js";
import type { BatchPair } from "./batch-read.js";
import type { BatchVector } from "./batch-vectors.js";

export function batchBodies(
  f: Flow,
  step: BatchVector,
  before: BatchPair,
  receipt: Receipt,
  actor: string,
) {
  const tx = readAcceptedTransaction(receipt.signedCbor);
  const raw = tx.spends.get(refId(before[0].basis.stateRef));

  assert.ok(raw);

  const action = redeemerFromData("state", decodeData(raw));

  assert.equal(action.operation, "batch");

  if (action.operation !== "batch") throw new Error("missing batch action");

  const refs = before
    .map((view) => view.data.request.ref)
    .sort((a, b) => a.txId.localeCompare(b.txId));

  expect(action.stateOutput).toBe(0n);
  expect(action.rewardOutput).toBe(3n);
  expect(action.rewardKey).toBe(actor);
  expect(action.entries.map((entry) => entry.requestRef)).toEqual(refs);

  for (const [index, request] of refs.entries()) {
    const ack = tx.spends.get(refId(request));

    assert.ok(ack);
    expect(redeemerFromData("request", decodeData(ack))).toEqual({
      role: "request",
      operation: "acknowledge",
      stateRef: before[0].basis.stateRef,
    });
    expect(action.entries[index]?.claimOutput).toBe(BigInt(index + 1));
    expect(action.entries[index]?.claimTopup).toBe(
      request.txId === before[0].data.request.ref.txId ? 1000000n : 2000000n,
    );
    expect(tx.inputs).toContainEqual(request);
  }

  expect(tx.inputs).toContainEqual(before[0].basis.stateRef);
  expect(tx.referenceInputs).toContainEqual(before[0].data.context.deployment.configRef);
  expect(tx.spends.size).toBe(3);
  expect(receipt.evaluations.filter((row) => row.redeemer_tag === "spend")).toHaveLength(3);
  expect(receipt.evaluations.filter((row) => row.redeemer_tag === "mint")).toHaveLength(
    step.delta === 0n ? 0 : 1,
  );

  const evidence = batchEvidence(receipt.signedCbor, f.installed.deployment.policy);

  expect(evidence.requiredSigners).toEqual([actor]);
  expect(evidence.signerHashes).toEqual([actor]);
  expect(evidence.hasMint).toBe(step.delta !== 0n);
  expect(evidence.shares).toBe(step.delta === 0n ? null : step.delta);
  expect(actor).not.toBe(f.installed.terms.pauseKey);

  return evidence;
}

export async function batchClaims(f: Flow, step: BatchVector, before: BatchPair, fixed: BatchPair) {
  const policy = f.installed.deployment.policy;

  for (const [index, response] of fixed.entries()) {
    const request = before[index]?.data.request.ref;
    const claim = response.data.claim;
    const amount = index === 0 ? step.issued : step.redeemed;
    const carry = index === 0 ? 7900000n : 8900000n;

    expect(response.data.request.status).toBe("claimable");
    expect(response.data.request.unspent).toBe(false);
    expect(response.data.request.settlement?.stateRef).toEqual(before[0].basis.stateRef);
    expect(response.data.request.settlement?.claimRef).toEqual(claim.ref);
    expect(claim.unspent).toBe(true);
    expect(claim.claim.requestRef).toEqual(request);
    expect(claim.claim.stateRef).toEqual(before[0].basis.stateRef);
    expect(claim.claim.receiver).toEqual(f.installed.receiver);
    expect(claim.claim.economicQuantity).toBe(amount);
    expect(claim.claim.carriedLovelace).toBe(carry);
    expect(claim.source.value).toEqual(
      index === 0
        ? { ada: carry, [`${policy}.${NAMES.share}`]: amount }
        : underlyingValue(f, amount, carry),
    );
    await readback(f, `${step.stage}-claim-${index}`, claim.ref, claim.source);
    expect(() => toPlannerInput(response.data.request)).toThrow("already consumed");
  }

  const ownership = fixed[0].data.ownership;

  expect(ownership.freeShares).toBe(before[0].data.snapshot.state.economicSupply - step.redeem);
  expect(ownership.issuedUndeliveredShares).toBe(step.issued);
  expect(ownership.fixedAssetClaims).toBe(step.redeemed);
  expect(ownership.lockedRedemptionShares).toBe(0n);
  expect(ownership.pendingDepositAssets).toBe(0n);
}

export async function batchState(
  f: Flow,
  step: BatchVector,
  before: BatchPair,
  fixed: BatchPair,
  plan: BatchPlan,
) {
  const expected = {
    ...before[0].data.snapshot.state,
    sequence: step.sequence,
    backingAssets: step.backing,
    economicSupply: step.backing,
    accruedFees: step.fees,
  };

  expect(plan.pricingBasis).toEqual(before[0].basis.stateRef);
  expect(plan.economicEffects).toEqual({
    backingDelta: step.delta,
    shareDelta: step.delta,
    feeDelta: step.entryFee + step.exitFee,
    grossSharesIssued: step.issued,
    grossSharesRedeemed: step.redeem,
    settlerReward: 200000n,
  });
  expect(plan.successor).toEqual(expected);
  expect(fixed[0].data.snapshot.state).toEqual(expected);
  expect(fixed[0].data.context.stateInput.value).toEqual(stateCustody(f, expected));
  expect(fixed[0].data.context.deployment.configRef).toEqual(
    before[0].data.context.deployment.configRef,
  );
  expect(fixed[0].data.snapshot.terms).toEqual(before[0].data.snapshot.terms);
  await readback(
    f,
    `${step.stage}-state`,
    fixed[0].basis.stateRef,
    fixed[0].data.context.stateInput,
  );

  const consumed = [before[0].basis.stateRef, ...before.map((view) => view.data.request.ref)];

  expect(
    await f.w.provider.getUtxosByOutRef(
      consumed.map((ref) => ({ txHash: ref.txId, outputIndex: Number(ref.index) })),
    ),
  ).toEqual([]);
}
