/** HTTP-decoded inputs enter unchanged family planners. Synthetic inclusion here is not ledger acceptance. */
import { buildDirectPlan } from "@ctvs/ctvs1";
import {
  buildBatchPlan,
  buildDeliverPlan,
  buildRefundPlanFromCbor,
  buildRequestPlan,
} from "@ctvs/ctvs2";
import { toPlannerContext, toPlannerInput } from "@ctvs/integration";
import type { Operation, Request } from "@ctvs/protocol";
import { bytes, constr, MAGIC, recoveryData } from "@ctvs/protocol";
import { expect, it } from "vitest";
import { inputAt } from "../../../../packages/integration/test/fixtures.js";
import { key } from "../../../../packages/planning/test/fixtures.js";
import { queryFixture } from "./query-fixture.js";

it("preserves all four direct plans, caller bounds and destinations through HTTP", async () => {
  const f = await queryFixture("ctvs1");

  f.sync();

  const vault = f.client.vault(f.policy);
  const cases: [Operation, bigint, bigint][] = [
    ["deposit", 101000n, 100000n],
    ["mint", 1000n, 1010n],
    ["withdraw", 500n, 505n],
    ["redeem", 500n, 495n],
  ];

  for (const [operation, amount, bound] of cases) {
    const remote = toPlannerContext((await vault.context()).data, "ctvs1");
    const local = f.reader.context(f.policy);

    if (local.deployment.family !== "ctvs1") throw new Error("wrong family");

    const action = { operation, amount, bound, receiver: { address: f.owner, datum: null } };
    const plan = buildDirectPlan({ ...remote, ...action });

    expect(plan).toEqual(buildDirectPlan({ ...local, deployment: local.deployment, ...action }));
    expect(plan.approvedBound).toBe(bound);
    expect(plan.ledgerConstruction.submitReady).toBe(false);
    f.accept(plan);
  }

  const context = (await vault.context()).data;

  expect(() => toPlannerContext(context, "ctvs2")).toThrow();
  expect(() =>
    toPlannerContext({
      ...context,
      deployment: { ...context.deployment, termsHash: "ff".repeat(32) },
    }),
  ).toThrow();
});

function requestFor(f: Awaited<ReturnType<typeof queryFixture>>, termsHash: string): Request {
  return {
    recovery: {
      vaultPolicy: f.policy,
      controller: key,
      refund: { address: f.owner, datum: null },
      deadlinePosixMs: 100000n,
    },
    body: {
      termsHash,
      kind: "deposit",
      offered: 101000n,
      minimumOutput: 100000n,
      receiver: {
        address: f.owner,
        datum: { constr: 127, fields: [{ map: [[-7n, new Uint8Array([0, 255])]] }] },
      },
      storageLovelace: 3000000n,
      executionBudget: 500000n,
      settlerFee: 100000n,
    },
  };
}

it("preserves async Request/Batch/Claim plans, then reverses them across rollback and cancellation", async () => {
  const f = await queryFixture();

  f.sync();

  const vault = f.client.vault(f.policy);
  const context = toPlannerContext((await vault.context()).data, "ctvs2");
  const request = requestFor(f, context.deployment.termsHash);
  const requestPlan = buildRequestPlan({ ...context, request });
  const created = f.accept(requestPlan);
  const ref = { txId: created.tx.id, index: 0n };
  const view = await vault.read({ context: true, request: { ref }, recoverySource: { ref } });
  const source = toPlannerInput(view.data.request);

  expect(source).toEqual(inputAt(requestPlan, created.tx.id, 0));
  expect(view.data.request.request).toEqual(request);
  expect(view.data.recoverySource.source.datumCbor).toBe(view.data.request.source.datumCbor);

  const batchContext = toPlannerContext(view.data.context, "ctvs2");
  const batch = buildBatchPlan({
    ...batchContext,
    requests: [{ input: source }],
    rewardKey: key,
    validity: { lowerPosixMs: 1n, upperPosixMs: 90000n },
  });
  const settled = f.accept(batch);
  const claimRef = { txId: settled.tx.id, index: 1n };
  const deliveryView = await vault.read({ context: true, claim: { ref: claimRef } });
  const deliveryContext = toPlannerContext(deliveryView.data.context, "ctvs2");
  const delivery = buildDeliverPlan({
    deployment: deliveryContext.deployment,
    claims: [toPlannerInput(deliveryView.data.claim)],
  });

  f.accept(delivery);
  expect((await vault.request({ ref })).data.status).toBe("delivered");
  expect(() => toPlannerInput({ ...deliveryView.data.claim, unspent: false })).toThrow(
    "already consumed",
  );
  expect((await vault.claim({ ref: claimRef })).data.unspent).toBe(false);
  f.runner.backward(settled.block.point, settled.block.point);
  expect((await vault.claim({ ref: claimRef })).data.unspent).toBe(true);
  f.runner.backward(created.block.point, created.block.point);
  f.reader.rollBackward(created.block.point);
  await expect(vault.claim({ ref: claimRef })).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    vault.read({ context: true }, { expectedBasis: deliveryView.basis }),
  ).rejects.toMatchObject({ code: "STALE_BASIS" });

  const recovery = (await vault.recoverySource({ ref })).data;

  if (recovery.deployment.family !== "ctvs2") throw new Error("wrong family");

  const refund = buildRefundPlanFromCbor({
    ...recovery,
    deployment: recovery.deployment,
    mode: "cancel",
    validity: { lowerPosixMs: 1n, upperPosixMs: 90000n },
  });

  f.accept(refund);
  expect((await vault.request({ ref })).data.status).toBe("refunded");
  await expect(vault.recoverySource({ ref })).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("keeps an unsupported economic body opaque through the HTTP refund handoff", async () => {
  const f = await queryFixture();

  f.sync();

  const vault = f.client.vault(f.policy);
  const context = toPlannerContext((await vault.context()).data, "ctvs2");
  const request = requestFor(f, context.deployment.termsHash);
  const original = buildRequestPlan({ ...context, request });
  const output = original.outputs[0];

  if (!output) throw new Error("missing request output");

  output.datum = constr(1, [bytes(MAGIC), 2n, recoveryData(request.recovery), constr(999, [1n])]);

  const created = f.accept(original);
  const ref = { txId: created.tx.id, index: 0n };
  const read = await vault.read({ request: { ref }, recoverySource: { ref } });

  expect(read.data.request.request).toBeNull();
  expect(read.data.request.validation.status).toBe("unsupported");

  const raw = read.data.recoverySource;

  if (raw.deployment.family !== "ctvs2") throw new Error("wrong family");

  const refund = buildRefundPlanFromCbor({
    ...raw,
    deployment: raw.deployment,
    mode: "expiry",
    validity: { lowerPosixMs: 100000n, upperPosixMs: 110000n },
  });

  expect(refund.outputs[0]?.value).toEqual(output.value);
  expect(raw.source.datumCbor).toBe(created.tx.outputs[0]?.datum);
});
