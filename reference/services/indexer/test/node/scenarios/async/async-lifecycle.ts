/** Deposit and redemption through HTTP-decoded Request/Claim sources and the existing family planners. */
import assert from "node:assert/strict";
import { buildBatchPlan, buildDeliverPlan, buildRequestPlan } from "@ctvs/ctvs2";
import { toPlannerContext, toPlannerInput } from "@ctvs/integration";
import type { QueryResponse } from "@ctvs/integration/query";
import { NAMES, type OutRef, type Request, type RequestKind } from "@ctvs/protocol";
import { expect } from "vitest";
import { datumHex } from "../../../../../../testing/ledger/serialization.js";
import { economicUnits, stateCustody, underlyingValue } from "../../support/assets.js";
import { write } from "../../support/environment.js";
import { execute, type Flow, type peer, readback, synced, validity } from "../../support/flow.js";

export async function create(
  f: Flow,
  kind: RequestKind,
  offered: bigint,
  minimumOutput: bigint,
  options: { stage?: string; deadlinePosixMs?: bigint } = {},
) {
  const stage = options.stage ?? `request-${kind}`;
  const view = await synced(
    () =>
      f.vault.read({
        snapshot: true,
        context: true,
        ownership: { address: f.installed.receiver.address },
      }),
    () => true,
    "Request context",
  );
  const context = toPlannerContext(view.data.context, "ctvs2");
  const controller = f.installed.terms.pauseKey;

  assert.ok(controller);

  const request: Request = {
    recovery: {
      vaultPolicy: context.deployment.policy,
      controller,
      refund: f.installed.receiver,
      deadlinePosixMs: options.deadlinePosixMs ?? validity(f.w).upperPosixMs + 120000n,
    },
    body: {
      termsHash: context.deployment.termsHash,
      kind,
      offered,
      minimumOutput,
      receiver: f.installed.receiver,
      storageLovelace: 5000000n,
      executionBudget: 2000000n,
      settlerFee: 100000n,
    },
  };
  const created = await execute(f, stage, buildRequestPlan({ ...context, request }));
  const ref = { txId: created.txId, index: 0n };
  const pending = await synced(
    () =>
      f.vault.read({
        snapshot: true,
        context: true,
        request: { ref },
        recoverySource: { ref },
        ownership: { address: f.installed.receiver.address },
      }),
    (value) => value.data.request.ref.txId === created.txId,
    `${kind} Request`,
  );

  expect(pending.data.snapshot.state).toEqual(view.data.snapshot.state);
  expect(pending.data.context.stateInput).toEqual(view.data.context.stateInput);
  expect(pending.data.request.status).toBe("pending_escrow");
  expect(pending.data.request.request).toEqual(request);
  expect(pending.data.recoverySource.source).toEqual(pending.data.request.source);
  expect(pending.data.request.source.value).toEqual(
    kind === "deposit"
      ? underlyingValue(f, offered, 7000000n)
      : { ada: 7000000n, [`${context.deployment.policy}.${NAMES.share}`]: offered },
  );
  expect(
    kind === "deposit"
      ? pending.data.ownership.pendingDepositAssets
      : pending.data.ownership.lockedRedemptionShares,
  ).toBe(
    offered +
      (kind === "deposit"
        ? view.data.ownership.pendingDepositAssets
        : view.data.ownership.lockedRedemptionShares),
  );
  await readback(f, stage, ref, pending.data.request.source);
  write(f.env.directory, `${stage}-sdk`, pending);

  return { ref, pending, request };
}

function lifecycleQueries(f: Flow, ref: OutRef, claimRef: OutRef) {
  return {
    snapshot: true as const,
    context: true as const,
    request: { ref },
    claim: { ref: claimRef },
    ownership: { address: f.installed.receiver.address },
  };
}

type LifecycleResponse = QueryResponse<ReturnType<typeof lifecycleQueries>>;

async function verifySettlement(
  f: Flow,
  kind: RequestKind,
  pending: Awaited<ReturnType<typeof create>>["pending"],
  fixed: LifecycleResponse,
) {
  const expected = kind === "deposit" ? 100000000n : 9900990n;

  expect(fixed.data.request.unspent).toBe(false);
  expect(fixed.data.claim.claim.requestRef).toEqual(pending.data.request.ref);
  expect(fixed.data.claim.claim.stateRef).toEqual(pending.data.context.stateInput.ref);
  expect(fixed.data.claim.claim.economicQuantity).toBe(expected);
  expect(fixed.data.claim.claim.carriedLovelace).toBe(7900000n);
  expect(fixed.data.claim.claim.receiver).toEqual(f.installed.receiver);
  expect(fixed.data.snapshot.state).toMatchObject({
    backingAssets: kind === "deposit" ? 100000000n : 90000000n,
    economicSupply: kind === "deposit" ? 100000000n : 90000000n,
    accruedFees: kind === "deposit" ? 1000000n : 1099010n,
    storageLovelace: 10000000n,
  });
  expect(fixed.data.context.stateInput.value).toEqual(stateCustody(f, fixed.data.snapshot.state));
  expect(fixed.data.claim.source.value).toEqual(
    kind === "deposit"
      ? {
          ada: 7900000n,
          [`${f.installed.deployment.policy}.${NAMES.share}`]: expected,
        }
      : underlyingValue(f, expected, 7900000n),
  );

  if (kind === "deposit") {
    expect(fixed.data.ownership.freeShares).toBe(0n);
    expect(fixed.data.ownership.issuedUndeliveredShares).toBe(expected);
  }

  await readback(
    f,
    `settle-${kind}-state`,
    fixed.data.context.stateInput.ref,
    fixed.data.context.stateInput,
  );
  await readback(f, `settle-${kind}-claim`, fixed.data.claim.ref, fixed.data.claim.source);
  expect(() => toPlannerInput(fixed.data.request)).toThrow("already consumed");
}

export async function lifecycle(
  f: Flow,
  actor: Awaited<ReturnType<typeof peer>>,
  kind: RequestKind,
) {
  f.w.selectOwner();

  const offered = kind === "deposit" ? 101000000n : 10000000n;
  const minimum = kind === "deposit" ? 100000000n : 9900000n;
  const preview =
    kind === "deposit"
      ? await f.vault.previewDeposit({ assets: offered })
      : await f.vault.previewRedeem({ shares: offered });

  expect(preview.data.result.status).toBe("known");
  economicUnits(f, preview.data);

  const { ref, pending } = await create(f, kind, offered, minimum);

  actor.select();

  const context = toPlannerContext(pending.data.context, "ctvs2");
  const batch = buildBatchPlan({
    ...context,
    requests: [{ input: toPlannerInput(pending.data.request), claimTopup: 1000000n }],
    rewardKey: actor.hash,
    rewardTopup: 2000000n,
    validity: validity(f.w),
  });
  const settled = await execute(f, `settle-${kind}`, batch);
  const claimRef = { txId: settled.txId, index: 1n };

  const read = () => f.vault.read(lifecycleQueries(f, ref, claimRef));

  const fixed = await synced(
    read,
    (value) => value.data.request.status === "claimable",
    `${kind} funded Claim`,
  );

  expect(fixed.data.snapshot.state).toEqual(batch.successor);
  expect({ status: "known", value: fixed.data.claim.claim.economicQuantity }).toEqual(
    preview.data.result,
  );
  expect(fixed.data.claim.claim.economicQuantity).toBeGreaterThanOrEqual(minimum);
  expect(pending.data.request.request?.body.minimumOutput).toBe(minimum);
  await verifySettlement(f, kind, pending, fixed);

  const delivery = buildDeliverPlan({
    deployment: toPlannerContext(fixed.data.context, "ctvs2").deployment,
    claims: [toPlannerInput(fixed.data.claim)],
  });

  expect(delivery.requiredSigners).toEqual([]);

  const delivered = await execute(f, `deliver-${kind}`, delivery);
  const after = await synced(
    read,
    (value) => value.data.request.status === "delivered",
    `${kind} delivery`,
  );

  expect(after.data.snapshot.state).toEqual(fixed.data.snapshot.state);
  expect(after.data.context.stateInput).toEqual(fixed.data.context.stateInput);
  expect(after.data.claim.unspent).toBe(false);
  expect(after.data.ownership.freeShares).toBe(kind === "deposit" ? 100000000n : 90000000n);
  expect(after.data.request.completion?.txId).toBe(delivered.txId);

  const output = delivery.outputs[0];

  assert.ok(output);
  await readback(
    f,
    `deliver-${kind}`,
    { txId: delivered.txId, index: 0n },
    {
      value: fixed.data.claim.source.value,
      datumCbor: output.datum === null ? null : datumHex(output.datum),
    },
  );
  write(f.env.directory, `settle-${kind}-sdk`, fixed);
  write(f.env.directory, `deliver-${kind}-sdk`, after);

  return after;
}
