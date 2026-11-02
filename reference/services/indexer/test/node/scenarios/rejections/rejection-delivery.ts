/** Whole-Claim payment and exhaustive, distinct delivery allocations must hold without a State or mint. */
import assert from "node:assert/strict";
import { buildDeliverPlan } from "@ctvs/ctvs2";
import { toPlannerContext, toPlannerInput } from "@ctvs/integration";
import type { ReadQueries } from "@ctvs/integration/query";
import { deliverRedeemer, enterprise, isConstr, type OutRef } from "@ctvs/protocol";
import { expect } from "vitest";
import type { Flow } from "../../support/flow.js";
import type { Actor } from "./rejection-common.js";
import { acceptControl } from "./rejection-control.js";
import { action, output, transfer } from "./rejection-mutations.js";
import { rejectVariants } from "./rejection-runner.js";
import { rejectSpent } from "./rejection-spent.js";

export async function deliveryRejections(
  f: Flow,
  requested: ReadQueries,
  refs: [OutRef, OutRef],
  actor: Actor,
  withdrawal: string,
) {
  const views = await Promise.all(refs.map((ref) => f.vault.read({ request: { ref } })));
  const claims = views.map((view) => view.data.request.settlement?.claimRef);

  assert.ok(claims[0] && claims[1]);

  const claimRefs: [OutRef, OutRef] = [claims[0], claims[1]];
  const sources = await Promise.all(
    claimRefs.map(async (ref) => toPlannerInput((await f.vault.claim({ ref })).data)),
  );
  const plan = buildDeliverPlan({
    deployment: toPlannerContext((await f.vault.context()).data, "ctvs2").deployment,
    claims: sources,
  });
  const selected = { ...requested, request: { ref: refs[0] }, claim: { ref: claimRefs[0] } };
  const result = await rejectVariants(
    f,
    selected,
    plan,
    [
      {
        label: "delivery-recipient",
        mutate: (candidate) => {
          output(candidate, 0).address = enterprise(actor.hash, "key");
        },
      },
      {
        label: "delivery-balanced-carry-theft",
        mutate: (candidate) => {
          transfer(candidate, 0, 1, "ada");
        },
      },
      {
        label: "delivery-incomplete-list",
        mutate: (candidate) => {
          const first = candidate.inputs[0];

          assert.ok(first);

          for (const input of candidate.inputs)
            input.redeemer = deliverRedeemer([{ claimRef: first.ref, receiverOutput: 0n }]);
        },
      },
      {
        label: "delivery-output-reuse",
        mutate: (candidate) => {
          const list = action(candidate, "claim").fields[0];

          assert.ok(Array.isArray(list));

          const second = list[1];

          assert.ok(second && isConstr(second));
          second.fields[1] = 0n;

          const redeemer = candidate.inputs[0]?.redeemer;

          assert.ok(redeemer);

          for (const input of candidate.inputs) input.redeemer = structuredClone(redeemer);
        },
      },
      {
        label: "delivery-forbidden-withdrawal",
        withdrawal,
        select: f.w.selectOwner,
        mutate: () => {},
      },
    ],
    actor.select,
  );

  const accepted = await acceptControl(
    f,
    selected,
    "accepted-delivery-control",
    plan,
    actor.select,
  );

  expect(accepted.receipt.txId).not.toBe(result.control.txId);

  const consumed = plan.inputs[0]?.ref;

  assert.ok(consumed);

  const spent = await rejectSpent(
    f,
    selected,
    { ...result.control, label: "spent-claim" },
    consumed,
  );

  for (const [index, ref] of refs.entries()) {
    expect((await f.vault.request({ ref })).data.status).toBe("delivered");

    const claim = claimRefs[index];

    assert.ok(claim);
    expect(() => toPlannerInput(accepted.after.data.claim)).toThrow("already consumed");
    expect((await f.vault.claim({ ref: claim })).data.unspent).toBe(false);
  }

  return {
    rejected: [...result.rejected, spent],
    history: refs.map((request, index) => ({ request, claim: claimRefs[index] })),
  };
}
