/** Two opposite Requests settle together, then both complete through permissionless grouped Claim delivery. */
import assert from "node:assert/strict";
import { buildBatchPlan, buildDeliverPlan } from "@ctvs/ctvs2";
import { readAcceptedTransaction, toPlannerContext, toPlannerInput } from "@ctvs/integration";
import type { OutRef } from "@ctvs/protocol";
import { expect } from "vitest";
import { ledgerAddress } from "../../../../../../testing/ledger/serialization.js";
import { batchEvidence } from "../../../support/evidence/batch.js";
import { write } from "../../support/environment.js";
import { execute, type Flow, type peer, readback, validity } from "../../support/flow.js";
import { type ForkNode, forge, freeze, primary, tip } from "../../support/fork.js";
import { create } from "../async/async-lifecycle.js";
import { batchBodies, batchClaims, batchState } from "./batch-checks.js";
import {
  type BatchPair,
  batchInventory,
  batchPoint,
  batchQueries,
  batchViews,
} from "./batch-read.js";
import type { BatchVector } from "./batch-vectors.js";

type Actor = Awaited<ReturnType<typeof peer>>;

/** A checkpoint freezes ledger time; submitting against a wall-clock lower bound can be premature. */
function batchValidity(f: Flow) {
  const slots = f.w.lucid.config().slotConfig;

  assert.ok(slots);

  return {
    ...validity(f.w),
    lowerPosixMs:
      BigInt(slots.zeroTime) +
      (BigInt(tip(primary(f.env)).slot) - 1n - BigInt(slots.zeroSlot)) * BigInt(slots.slotLength),
  };
}

export async function pendingBatch(f: Flow, step: BatchVector, deadlinePosixMs?: bigint) {
  f.w.selectOwner();
  forge(primary(f.env));

  const deposit = await create(f, "deposit", step.deposit, step.issued, {
    stage: `${step.stage}-request-deposit`,
    ...(deadlinePosixMs === undefined ? {} : { deadlinePosixMs }),
  });
  const redeem = await create(f, "redeem", step.redeem, step.redeemed, {
    stage: `${step.stage}-request-redeem`,
    ...(deadlinePosixMs === undefined ? {} : { deadlinePosixMs }),
  });
  const refs: [OutRef, OutRef] = [deposit.ref, redeem.ref];
  const before = await batchPoint(f, step, refs, `${step.stage}-pending`);
  const state = before[0].data.snapshot.state;

  expect(before[0].data.request.status).toBe("pending_escrow");
  expect(before[1].data.request.status).toBe("pending_escrow");
  expect(state.sequence).toBe(step.sequence - 1n);
  expect(before[0].data.ownership.freeShares).toBe(state.economicSupply - step.redeem);
  expect(before[0].data.ownership.lockedRedemptionShares).toBe(step.redeem);
  expect(before[0].data.ownership.pendingDepositAssets).toBe(step.deposit);
  expect(before[0].data.ownership.issuedUndeliveredShares).toBe(0n);
  expect(before[0].data.ownership.fixedAssetClaims).toBe(0n);
  batchViews(f, step, before);

  return { refs, before };
}

export async function settleBatch(
  f: Flow,
  step: BatchVector,
  refs: [OutRef, OutRef],
  before: BatchPair,
  actor: Actor,
  producer: ForkNode = primary(f.env),
) {
  const context = toPlannerContext(
    before[0].data.previewDeposit.construction ?? before[0].data.context,
    "ctvs2",
  );
  const requests = before
    .map((response, index) => ({
      input: toPlannerInput(response.data.request),
      claimTopup: index === 0 ? 1000000n : 2000000n,
    }))
    .sort((a, b) => b.input.ref.txId.localeCompare(a.input.ref.txId));
  const plan = buildBatchPlan({
    ...context,
    requests,
    rewardKey: actor.hash,
    rewardTopup: 2000000n,
    validity: batchValidity(f),
  });

  actor.select();
  forge(producer);

  const receipt = await execute(f, `${step.stage}-settle`, plan);

  await freeze(producer);

  const sorted = [...refs].sort((a, b) => a.txId.localeCompare(b.txId));
  const claims: [OutRef, OutRef] = [
    { txId: receipt.txId, index: BigInt(sorted.findIndex((ref) => ref.txId === refs[0].txId) + 1) },
    { txId: receipt.txId, index: BigInt(sorted.findIndex((ref) => ref.txId === refs[1].txId) + 1) },
  ];
  const fixed = await batchPoint(f, step, refs, `${step.stage}-settled`, claims);
  const evidence = batchBodies(f, step, before, receipt, actor.hash);

  expect(fixed[0].basis.stateRef).toEqual({ txId: receipt.txId, index: 0n });
  await batchState(f, step, before, fixed, plan);
  await batchClaims(f, step, before, fixed);
  batchViews(f, step, fixed);
  await batchInventory(f, fixed, step.stage);
  await readback(
    f,
    `${step.stage}-reward`,
    { txId: receipt.txId, index: 3n },
    { value: { ada: 2200000n }, datumCbor: null },
  );

  const accepted = readAcceptedTransaction(receipt.signedCbor);

  expect(accepted.outputs[3]?.address).toBe(actor.address);
  await expect(
    f.vault.read(batchQueries(f, step, refs[0]), { expectedBasis: before[0].basis }),
  ).rejects.toMatchObject({ code: "STALE_BASIS" });
  write(f.env.directory, `${step.stage}-batch`, {
    step,
    before,
    fixed,
    evidence,
    effects: plan.economicEffects,
    pricingBasis: plan.pricingBasis,
    txId: receipt.txId,
    claims,
  });

  return { fixed, claims, receipt };
}

export async function deliverBatch(
  f: Flow,
  step: BatchVector,
  refs: [OutRef, OutRef],
  fixed: BatchPair,
  claims: [OutRef, OutRef],
  actor: Actor,
  producer: ForkNode = primary(f.env),
) {
  const plan = buildDeliverPlan({
    deployment: toPlannerContext(fixed[0].data.context, "ctvs2").deployment,
    claims: [...fixed].reverse().map((view) => toPlannerInput(view.data.claim)),
  });

  expect(plan.requiredSigners).toEqual([]);
  actor.select();
  forge(producer);

  const receipt = await execute(f, `${step.stage}-deliver`, plan);

  await freeze(producer);

  const after = await batchPoint(f, step, refs, `${step.stage}-delivered`, claims);
  const accepted = readAcceptedTransaction(receipt.signedCbor);
  const evidence = batchEvidence(receipt.signedCbor, f.installed.deployment.policy);

  expect(evidence).toEqual({
    hasMint: false,
    shares: null,
    requiredSigners: [],
    signerHashes: [actor.hash],
  });
  expect(accepted.inputs).not.toContainEqual(fixed[0].basis.stateRef);
  expect(accepted.referenceInputs).not.toContainEqual(fixed[0].data.context.deployment.configRef);
  expect(receipt.evaluations).toHaveLength(2);
  expect(after[0].data.context.stateInput).toEqual(fixed[0].data.context.stateInput);
  expect(after[0].data.snapshot.state).toEqual(fixed[0].data.snapshot.state);
  expect(after[0].data.ownership).toMatchObject({
    freeShares: step.backing,
    issuedUndeliveredShares: 0n,
    fixedAssetClaims: 0n,
    pendingDepositAssets: 0n,
    lockedRedemptionShares: 0n,
  });

  for (const [index, view] of after.entries()) {
    const source = fixed[index]?.data.claim;

    assert.ok(source);
    expect(view.data.request.status).toBe("delivered");
    expect(view.data.request.completion?.txId).toBe(receipt.txId);
    expect(view.data.claim.unspent).toBe(false);
    expect(() => toPlannerInput(view.data.claim)).toThrow("already consumed");

    const outputIndex = Number(source.ref.index) - 1;

    expect(accepted.outputs[outputIndex]?.address).toBe(
      ledgerAddress(f.installed.receiver.address),
    );
    await readback(
      f,
      `${step.stage}-delivery-${index}`,
      { txId: receipt.txId, index: BigInt(outputIndex) },
      { value: source.source.value, datumCbor: null },
    );
  }

  batchViews(f, step, after);
  await expect(
    f.vault.read(batchQueries(f, step, refs[0], claims[0]), { expectedBasis: fixed[0].basis }),
  ).rejects.toMatchObject({ code: "STALE_BASIS" });
  write(f.env.directory, `${step.stage}-delivery`, { fixed, after, evidence, txId: receipt.txId });

  return after;
}

export async function mixedBatch(f: Flow, step: BatchVector, actor: Actor) {
  const { refs, before } = await pendingBatch(f, step);
  const { fixed, claims, receipt } = await settleBatch(f, step, refs, before, actor);
  const after = await deliverBatch(f, step, refs, fixed, claims, actor);

  return { step, refs, claims, before, fixed, after, txId: receipt.txId };
}
