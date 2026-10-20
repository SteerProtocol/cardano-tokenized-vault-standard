/** HTTP sources remain authoritative; only adversarial planner evidence is relaxed to reach node guards. */
import assert from "node:assert/strict";
import { buildBatchPlan } from "@ctvs/ctvs2";
import { toPlannerContext, toPlannerInput } from "@ctvs/integration";
import type { OutRef } from "@ctvs/protocol";
import { requestData, requestFromData, stateData, stateFromData } from "@ctvs/protocol";
import type { Flow } from "../../support/flow.js";
import { forge, primary } from "../../support/fork.js";
import { create } from "../async/async-lifecycle.js";
import type { Actor } from "./rejection-common.js";
import { rejectionValidity } from "./rejection-control.js";
import { output } from "./rejection-mutations.js";

export async function rejectionRequests(f: Flow) {
  f.w.selectOwner();
  forge(primary(f.env));

  const deadlinePosixMs = rejectionValidity(f).upperPosixMs + 600000n;
  const deposit = await create(f, "deposit", 10100000n, 10000000n, {
    stage: "guard-deposit",
    deadlinePosixMs,
  });
  const redeem = await create(f, "redeem", 10000000n, 9900990n, {
    stage: "guard-redeem",
    deadlinePosixMs,
  });
  const badDeposit = await create(f, "deposit", 10100000n, 10000001n, {
    stage: "guard-bad-deposit-minimum",
    deadlinePosixMs,
  });
  const badRedeem = await create(f, "redeem", 10000000n, 9900991n, {
    stage: "guard-bad-redeem-minimum",
    deadlinePosixMs,
  });

  return {
    refs: [deposit.ref, redeem.ref] as [OutRef, OutRef],
    bad: [badDeposit.ref, badRedeem.ref] as [OutRef, OutRef],
  };
}

export async function rejectionBatch(
  f: Flow,
  refs: OutRef[],
  actor: Actor,
  relaxed = false,
  paused = false,
) {
  const context = toPlannerContext((await f.vault.context()).data, "ctvs2");
  const state = stateFromData(context.stateInput.datum);
  const requests = [];

  for (const ref of refs) {
    const source = toPlannerInput((await f.vault.request({ ref })).data);

    if (relaxed) {
      const request = requestFromData(source.datum);

      source.datum = requestData({
        ...request,
        body: {
          ...request.body,
          minimumOutput: request.body.kind === "deposit" ? 10000000n : 9900990n,
        },
      });
    }

    requests.push({ input: source, claimTopup: 1000000n });
  }

  const plan = buildBatchPlan({
    ...context,
    requests,
    rewardKey: actor.hash,
    rewardTopup: 2000000n,
    validity: rejectionValidity(f),
    stateInput: paused
      ? { ...context.stateInput, datum: stateData({ ...state, pauseFlags: 0n }) }
      : context.stateInput,
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
