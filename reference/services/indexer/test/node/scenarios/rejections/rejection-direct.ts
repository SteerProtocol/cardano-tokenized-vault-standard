/** Direct bounds, payouts, closed State custody, spent inputs and directional pause on the actual ledger. */
import assert from "node:assert/strict";
import { buildDirectPlan } from "@ctvs/ctvs1";
import { toPlannerContext } from "@ctvs/integration";
import type { ReadQueries } from "@ctvs/integration/query";
import { assetId, directRedeemer, enterprise, stateData, stateFromData } from "@ctvs/protocol";
import { evaluated } from "../../../support/evidence/rpc.js";
import type { Flow } from "../../support/flow.js";
import { nodeRpc } from "../../support/rpc.js";
import { negativeCandidate } from "./rejection-candidate.js";
import type { Actor } from "./rejection-common.js";
import { acceptControl, pausePlan } from "./rejection-control.js";
import { action, output, transfer } from "./rejection-mutations.js";
import { type RejectionVariant, rejectVariants } from "./rejection-runner.js";
import { rejectSpent } from "./rejection-spent.js";
import { rejectWalletPayment } from "./rejection-wallet.js";

const steps = [
  { operation: "deposit", amount: 1010000n, bound: 1000000n, bad: 1000001n },
  { operation: "mint", amount: 1000000n, bound: 1010000n, bad: 1009999n },
  { operation: "withdraw", amount: 990000n, bound: 999900n, bad: 999899n },
  { operation: "redeem", amount: 1000000n, bound: 990000n, bad: 990100n },
] as const;

async function directPlan(f: Flow, step: (typeof steps)[number], paused = false) {
  const context = toPlannerContext((await f.vault.context()).data, "ctvs1");
  const state = stateFromData(context.stateInput.datum);
  const plan = buildDirectPlan({
    ...context,
    ...step,
    stateInput: paused
      ? { ...context.stateInput, datum: stateData({ ...state, pauseFlags: 0n }) }
      : context.stateInput,
    receiver: f.installed.receiver,
    receiverTopup: 2000000n,
  });

  if (paused) {
    const successor = output(plan, 0);

    assert.ok(successor.datum);
    successor.datum = stateData({
      ...stateFromData(successor.datum),
      pauseFlags: state.pauseFlags,
    });
  }

  return plan;
}

function variants(f: Flow, step: (typeof steps)[number], actor: Actor): RejectionVariant[] {
  const cases: RejectionVariant[] = [
    {
      label: `direct-${step.operation}-bound`,
      mutate: (plan) => {
        const input = plan.inputs[0];

        assert.ok(input);
        input.redeemer = directRedeemer(step.operation, {
          receiver: f.installed.receiver,
          amount: step.amount,
          bound: step.bad,
          stateOutput: 0n,
          receiverOutput: 1n,
        });
      },
    },
  ];

  if (step.operation === "deposit")
    cases.push(
      {
        label: "direct-recipient",
        mutate: (plan) => {
          output(plan, 1).address = enterprise(actor.hash, "key");
        },
      },
      {
        label: "direct-balanced-theft",
        mutate: (plan) => {
          transfer(plan, 0, 1, assetId(f.installed.terms.underlying));
        },
      },
      {
        label: "direct-output-reuse",
        mutate: (plan) => {
          action(plan).fields[4] = 0n;
        },
      },
    );

  return cases;
}

export async function directRejections(f: Flow, requested: ReadQueries, actor: Actor) {
  const rejected = [];

  for (const step of steps) {
    const result = await rejectVariants(
      f,
      requested,
      await directPlan(f, step),
      variants(f, step, actor),
    );

    rejected.push(...result.rejected);
  }

  const deposit = steps[0];
  const plan = await directPlan(f, deposit);
  const stalePlan = structuredClone(plan);

  output(stalePlan, 1).value.ada = 2100000n;

  const stale = await negativeCandidate(f, "spent-state", stalePlan);

  evaluated(await nodeRpc(f, "evaluateTransaction", stale.signedCbor));
  await rejectWalletPayment(f, requested, plan, actor.address);
  await acceptControl(f, requested, "accepted-direct-control", plan);
  rejected.push(
    await rejectSpent(f, requested, stale, stalePlan.inputs[0]?.ref ?? { txId: "", index: 0n }),
  );
  await acceptControl(f, requested, "accepted-pause-both", await pausePlan(f, 3n));

  const entry = await directPlan(f, deposit, true);
  const exit = await directPlan(f, steps[3], true);
  const unpause = await pausePlan(f, 0n);
  const paused = await rejectVariants(f, requested, unpause, [
    {
      label: "paused-entry",
      mutate: (candidate) => {
        Object.assign(candidate, entry);
      },
    },
    {
      label: "paused-exit",
      mutate: (candidate) => {
        Object.assign(candidate, exit);
      },
    },
  ]);

  rejected.push(...paused.rejected);
  await acceptControl(f, requested, "accepted-unpause", unpause);
  await acceptControl(f, requested, "accepted-unpaused-direct", await directPlan(f, deposit));

  return rejected;
}
