/** Rollback assertions use live SDK responses, actual node chain-sync events and persistent Kupo readback. */
import assert from "node:assert/strict";
import { buildBatchPlan, buildDeliverPlan, buildRefundPlanFromCbor } from "@ctvs/ctvs2";
import { toPlannerContext, toPlannerInput } from "@ctvs/integration";
import { NAMES } from "@ctvs/protocol";
import { expect } from "vitest";
import { underlyingValue } from "../../support/assets.js";
import type { capture } from "../../support/capture.js";
import { eventually, write } from "../../support/environment.js";
import {
  execute,
  type Flow,
  peer,
  readback,
  receipts,
  synced,
  validity,
} from "../../support/flow.js";
import { checkpoint, type ForkNode, forge, freeze, primary, tip } from "../../support/fork.js";
import { reconcileFork } from "../../support/lookup.js";
import { persistentRestart, queries, replay, statelessRead } from "../../support/persistence.js";
import { create, lifecycle } from "./async-lifecycle.js";
import { recoveryCustody } from "./recovery-custody.js";

function chainValidity(f: Flow) {
  const slots = f.w.lucid.config().slotConfig;

  assert.ok(slots);

  const current = tip(primary(f.env));

  return {
    ...validity(f.w),
    lowerPosixMs:
      BigInt(slots.zeroTime) +
      (BigInt(current.slot) - 1n - BigInt(slots.zeroSlot)) * BigInt(slots.slotLength),
  };
}

export async function originalBranch(
  f: Flow,
  copies: ForkNode[],
  kind: "deposit" | "redeem" = "deposit",
) {
  if (kind === "redeem") await lifecycle(f, await peer(f), "deposit");

  f.w.selectOwner();

  const { ref, pending } = await create(
    f,
    kind,
    kind === "deposit" ? 101000000n : 10000000n,
    kind === "deposit" ? 100000000n : 9900000n,
  );
  const requestFork = await checkpoint(f.env, "request-fork", copies);

  forge(primary(f.env));

  const context = toPlannerContext(pending.data.context, "ctvs2");
  const rewardKey = f.installed.terms.pauseKey;

  assert.ok(rewardKey);

  const settled = await execute(
    f,
    `settle-${kind}`,
    buildBatchPlan({
      ...context,
      requests: [{ input: toPlannerInput(pending.data.request) }],
      rewardKey,
      rewardTopup: 2000000n,
      validity: chainValidity(f),
    }),
  );
  const claimRef = { txId: settled.txId, index: 1n };
  const fixed = await synced(
    () => f.vault.read({ context: true, request: { ref }, claim: { ref: claimRef } }),
    (value) => value.data.request.status === "claimable",
    "settled original branch",
  );

  expect(fixed.data.claim.source.value).toEqual(
    kind === "deposit"
      ? { ada: 6900000n, [`${context.deployment.policy}.${NAMES.share}`]: 100000000n }
      : underlyingValue(f, 9900990n, 6900000n),
  );
  await readback(f, "original-claim", claimRef, fixed.data.claim.source);

  const deliveryFork = await checkpoint(f.env, "delivery-fork", copies);

  forge(primary(f.env));

  const delivered = await execute(
    f,
    `deliver-${kind}`,
    buildDeliverPlan({
      deployment: context.deployment,
      claims: [toPlannerInput(fixed.data.claim)],
    }),
  );

  await synced(
    () => f.vault.request({ ref }),
    (value) => value.data.status === "delivered",
    "original delivery",
  );
  await freeze(primary(f.env));

  const requested = queries(f, ref, claimRef);
  const original = await synced(
    () => f.vault.read(requested),
    (value) => value.data.request.status === "delivered",
    "frozen delivered branch",
  );

  expect(original.data.ownership.freeShares).toBe(kind === "deposit" ? 100000000n : 90000000n);
  await recoveryCustody(f, original, "original-delivered");
  await readback(
    f,
    "original-delivery",
    { txId: delivered.txId, index: 0n },
    { value: fixed.data.claim.source.value, datumCbor: null },
  );
  await statelessRead(f, requested, "original-parity");
  replay(f, requested, original, "original-delivered");
  write(f.env.directory, "original-delivered", original);

  return {
    kind,
    pending,
    ref,
    claimRef,
    delivered,
    requestFork,
    deliveryFork,
    requested,
    original,
  };
}

type Original = Awaited<ReturnType<typeof originalBranch>>;

export async function rollbackDelivery(
  f: Flow,
  branch: Original,
  chain: Awaited<ReturnType<typeof capture>>,
) {
  const before = await f.vault.read(branch.requested);
  const selected = await reconcileFork(
    f,
    branch.deliveryFork.node,
    "delivery-rollback",
    branch.requested,
  );

  const restored = await synced(
    () => f.vault.read(branch.requested),
    (value) => value.data.request.status === "claimable" && value.data.claim?.unspent === true,
    "actual delivery rollback",
  );

  expect(restored.basis.instance).toBe(before.basis.instance);
  expect(restored.basis.recoveryGeneration).toBeGreaterThan(before.basis.recoveryGeneration);
  expect(restored.data.ownership.freeShares).toBe(branch.pending.data.ownership.freeShares);
  expect(restored.data.ownership.issuedUndeliveredShares).toBe(
    branch.kind === "deposit" ? 100000000n : 0n,
  );
  expect(restored.data.ownership.fixedAssetClaims).toBe(branch.kind === "redeem" ? 9900990n : 0n);
  expect(restored.data.context.stateInput).toEqual(branch.original.data.context.stateInput);
  expect(restored.data.request.completion).toBeNull();
  await eventually(
    async () =>
      chain.rollbacks.find(
        (event) => event.point.blockHash === branch.deliveryFork.common.blockHash,
      ),
    "actual delivery rollback message",
  );
  await eventually(
    async () =>
      (await f.w.provider.getUtxosByOutRef([{ txHash: branch.claimRef.txId, outputIndex: 1 }]))
        .length
        ? true
        : undefined,
    "Kupo restored Claim",
  );
  await readback(f, "restored-claim", branch.claimRef, restored.data.claim?.source);
  await recoveryCustody(f, restored, "delivery-rollback");
  await statelessRead(f, branch.requested, "delivery-parity");
  expect(
    await f.w.provider.getUtxosByOutRef([{ txHash: branch.delivered.txId, outputIndex: 0 }]),
  ).toEqual([]);
  await expect(
    f.vault.read(branch.requested, { expectedBasis: before.basis }),
  ).rejects.toMatchObject({ code: "STALE_BASIS" });
  write(f.env.directory, "delivery-rollback-sdk", {
    selected,
    restored,
    rollbacks: chain.rollbacks,
  });
  replay(f, branch.requested, restored, "delivery-rollback");

  return restored;
}

export async function rollbackSettlement(
  f: Flow,
  branch: Original,
  chain: Awaited<ReturnType<typeof capture>>,
) {
  const previous = await f.vault.read(branch.requested);
  const pendingQueries = queries(f, branch.ref);
  const selected = await reconcileFork(
    f,
    branch.requestFork.node,
    "settlement-rollback",
    pendingQueries,
  );
  const restored = await synced(
    () => f.vault.read(pendingQueries),
    (value) => value.data.request.status === "pending_escrow",
    "actual settlement rollback",
  );

  expect(restored.basis.instance).toBe(previous.basis.instance);
  expect(restored.basis.recoveryGeneration).toBeGreaterThan(previous.basis.recoveryGeneration);
  expect(restored.data.snapshot.state).toEqual(branch.pending.data.snapshot.state);
  expect(restored.data.ownership).toEqual(branch.pending.data.ownership);
  expect(restored.data.request.settlement).toBeNull();
  await eventually(
    async () =>
      chain.rollbacks.find(
        (event) => event.point.blockHash === branch.requestFork.common.blockHash,
      ),
    "actual settlement rollback message",
  );
  await expect(f.vault.claim({ ref: branch.claimRef })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await expect(
    f.vault.read(pendingQueries, { expectedBasis: previous.basis }),
  ).rejects.toMatchObject({ code: "STALE_BASIS" });

  const raw = (await f.vault.recoverySource({ ref: branch.ref })).data;

  await eventually(
    async () =>
      (await f.w.provider.getUtxosByOutRef([{ txHash: branch.ref.txId, outputIndex: 0 }])).length
        ? true
        : undefined,
    "Kupo restored Request",
  );
  await readback(f, "restored-request", branch.ref, raw.source);
  await recoveryCustody(f, restored, "settlement-rollback");
  await statelessRead(f, pendingQueries, "settlement-parity");
  expect(
    await f.w.provider.getUtxosByOutRef([{ txHash: branch.claimRef.txId, outputIndex: 1 }]),
  ).toEqual([]);
  replay(f, pendingQueries, restored, "settlement-rollback");
  write(f.env.directory, "settlement-rollback-sdk", {
    selected,
    restored,
    rollbacks: chain.rollbacks,
  });

  if (raw.deployment.family !== "ctvs2") throw new Error("wrong family");

  forge(branch.requestFork.node);
  f.w.selectOwner();

  const cancelled = await execute(
    f,
    "replacement-cancel",
    buildRefundPlanFromCbor({
      ...raw,
      deployment: raw.deployment,
      mode: "cancel",
      validity: chainValidity(f),
    }),
  );

  await synced(
    () => f.vault.request({ ref: branch.ref }),
    (value) => value.data.status === "refunded",
    "replacement cancellation",
  );
  await freeze(branch.requestFork.node);

  await receipts({ ...f, receipts: [cancelled] }, chain);
  await chain.close();

  const after = await persistentRestart(f, pendingQueries, "restart-replacement", true);

  expect(after.data.request.completion?.txId).toBe(cancelled.txId);
  expect(after.data.snapshot.state).toEqual(branch.pending.data.snapshot.state);
  expect(after.data.ownership.pendingDepositAssets).toBe(0n);
  expect(after.data.ownership.lockedRedemptionShares).toBe(0n);
  expect(after.data.ownership.freeShares).toBe(branch.kind === "deposit" ? 0n : 100000000n);
  await recoveryCustody(f, after, "replacement");
  await readback(
    f,
    "replacement-refund",
    { txId: cancelled.txId, index: 0n },
    { value: raw.source.value, datumCbor: null },
  );

  return after;
}
