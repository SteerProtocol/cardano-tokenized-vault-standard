/** Zero-net settlement must enforce both gross obligations through State and Request spends. */
import assert from "node:assert/strict";
import type { ReadQueries } from "@ctvs/integration/query";
import type { TransactionPlan } from "@ctvs/planning";
import {
  acknowledgeRedeemer,
  assetId,
  claimData,
  claimFromData,
  enterprise,
  isConstr,
  type OutRef,
  refId,
} from "@ctvs/protocol";
import { expect } from "vitest";
import { batchEvidence } from "../../../support/evidence/batch.js";
import type { Flow } from "../../support/flow.js";
import { rejectionBatch } from "./rejection-async-source.js";
import type { Actor } from "./rejection-common.js";
import { acceptControl, pausePlan } from "./rejection-control.js";
import { batchEntries, output, transfer } from "./rejection-mutations.js";
import { type RejectionVariant, rejectVariants } from "./rejection-runner.js";
import { rejectWalletPayment } from "./rejection-wallet.js";

export async function minimumRejections(
  f: Flow,
  requested: ReadQueries,
  refs: [OutRef, OutRef],
  bad: [OutRef, OutRef],
  actor: Actor,
) {
  const rejected = [];

  for (const index of [0, 1]) {
    const ref = refs[index],
      badRef = bad[index];

    assert.ok(ref && badRef);

    const control = await rejectionBatch(f, [ref], actor);
    const impossible = await rejectionBatch(f, [badRef], actor, true);
    const result = await rejectVariants(
      f,
      { ...requested, request: { ref: badRef } },
      control,
      [
        {
          label: index === 0 ? "request-deposit-minimum" : "request-redeem-minimum",
          mutate: (plan) => {
            Object.assign(plan, impossible);
          },
        },
      ],
      actor.select,
    );

    rejected.push(...result.rejected);
  }

  return rejected;
}

export async function pausedBatchRejections(
  f: Flow,
  requested: ReadQueries,
  refs: [OutRef, OutRef],
  actor: Actor,
) {
  await acceptControl(f, requested, "accepted-pause-both", await pausePlan(f, 3n));

  const entry = await rejectionBatch(f, [refs[0]], actor, false, true);
  const exit = await rejectionBatch(f, [refs[1]], actor, false, true);
  const unpause = await pausePlan(f, 0n);
  const result = await rejectVariants(f, requested, unpause, [
    {
      label: "paused-entry",
      select: actor.select,
      mutate: (plan) => {
        Object.assign(plan, entry);
      },
    },
    {
      label: "paused-exit",
      select: actor.select,
      mutate: (plan) => {
        Object.assign(plan, exit);
      },
    },
  ]);

  await acceptControl(f, requested, "accepted-unpause", unpause);

  return result.rejected;
}

function claimOutput(plan: TransactionPlan, ref: OutRef) {
  const claim = plan.outputs.find(
    (output) =>
      output.role === "claim" &&
      output.datum !== null &&
      refId(claimFromData(output.datum).requestRef) === refId(ref),
  );

  assert.ok(claim);

  return claim;
}

function zeroVariants(f: Flow, refs: [OutRef, OutRef], actor: Actor): RejectionVariant[] {
  return [
    {
      label: "zero-net-claim-recipient",
      mutate: (plan) => {
        const selected = output(plan, 1);

        assert.ok(selected.datum);
        selected.datum = claimData({
          ...claimFromData(selected.datum),
          receiver: { address: enterprise(actor.hash, "key"), datum: null },
        });
      },
    },
    {
      label: "zero-net-claim-carry-theft",
      mutate: (plan) => {
        transfer(plan, 1, 3, "ada");
      },
    },
    {
      label: "zero-net-balanced-state-theft",
      mutate: (plan) => {
        transfer(
          plan,
          0,
          Number(claimOutput(plan, refs[1]).index),
          assetId(f.installed.terms.underlying),
        );
      },
    },
    {
      label: "zero-net-output-reuse",
      mutate: (plan) => {
        const entries = batchEntries(plan),
          first = entries[0],
          second = entries[1];

        assert.ok(first && second && isConstr(first) && isConstr(second));
        second.fields[1] = first.fields[1] ?? -1n;
      },
    },
    ...refs.map((ref, index) => ({
      label: `zero-net-missing-${index === 0 ? "deposit" : "redemption"}-claim`,
      mutate: (plan: TransactionPlan) => {
        const selected = claimOutput(plan, ref);

        selected.address = enterprise(actor.hash, "key");
        selected.datum = null;
        selected.datumMode = "none";
      },
    })),
    {
      label: "zero-net-wrong-acknowledgement",
      mutate: (plan) => {
        const request = plan.inputs.find((input) => input.role === "request");

        assert.ok(request);
        request.redeemer = acknowledgeRedeemer(f.installed.deployment.configRef);
      },
    },
    {
      label: "zero-net-missing-settler",
      mutate: (plan) => {
        plan.requiredSigners = [];
      },
    },
  ];
}

export async function zeroBatchRejections(
  f: Flow,
  requested: ReadQueries,
  refs: [OutRef, OutRef],
  actor: Actor,
) {
  const plan = await rejectionBatch(f, refs, actor);

  expect(plan.mint).toEqual([]);

  const result = await rejectVariants(
    f,
    requested,
    plan,
    zeroVariants(f, refs, actor),
    actor.select,
  );
  const evidence = batchEvidence(result.control.signedCbor, f.installed.deployment.policy);

  expect(evidence.hasMint).toBe(false);
  await rejectWalletPayment(f, requested, plan, actor.address);

  const accepted = await acceptControl(
    f,
    requested,
    "accepted-zero-net-control",
    plan,
    actor.select,
  );

  return { rejected: result.rejected, receipt: accepted.receipt };
}
