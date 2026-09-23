/** CTVS-2 settlement consumes Requests against one State snapshot and allocates funded Claims. */
import type { FamilyStateContext, TimeBounds, TransactionPlan } from "@ctvs/planning";
import {
  claimValue,
  createPlan,
  finiteValidity,
  input,
  output,
  resolveState,
  scriptDestination,
  stateValue,
  value,
} from "@ctvs/planning";
import type { OutRef, State } from "@ctvs/protocol";
import {
  acknowledgeRedeemer,
  batchRedeemer,
  claimData,
  credentialData,
  enterprise,
  equalHex,
  mintRedeemer,
  NAMES,
  quantity,
  sortedReferences,
  stateData,
  validateEconomics,
} from "@ctvs/protocol";
import type { BatchRequest, SettledRequest } from "./settlement.js";
import { accumulate, emptyTotals, settleRequest } from "./settlement.js";

export interface BatchOptions extends FamilyStateContext<"ctvs2"> {
  requests: BatchRequest[];
  rewardKey: string;
  validity: TimeBounds;
  /** External lovelace for the reward output; only valid when total settlerReward is positive. */
  rewardTopup?: bigint;
}
export interface BatchPlan extends TransactionPlan {
  operation: "batch";
  /** Input State reference shared by every Request quote, not the successor output. */
  pricingBasis: OutRef;
  successor: State;
  economicEffects: {
    backingDelta: bigint;
    shareDelta: bigint;
    feeDelta: bigint;
    grossSharesIssued: bigint;
    grossSharesRedeemed: bigint;
    settlerReward: bigint;
  };
}

/**
 * Allocate State at index 0, one Claim per already-sorted settlement, then an optional reward.
 * Return entries using those exact output indices so ordering and redeemer links cannot drift.
 * Reward top-up is external lovelace and is forbidden when the batch has no settler fee;
 * the caller has already checked economic settlement and aggregate successor bounds.
 */
function batchOutputLayout(
  { deployment, terms, rewardKey }: BatchOptions,
  successor: State,
  settlements: SettledRequest[],
  reward: bigint,
  rewardTopup: bigint,
) {
  const outputs = [
    output(
      "state",
      scriptDestination(deployment.policy),
      stateValue(successor, terms),
      stateData(successor),
    ),
    ...settlements.map((item) =>
      output(
        "claim",
        scriptDestination(deployment.claimScript),
        claimValue(item.claim),
        claimData(item.claim),
      ),
    ),
  ];
  const entries = settlements.map((item, index) => ({
    requestRef: item.source.ref,
    claimOutput: BigInt(index + 1),
    claimTopup: item.claimTopup,
  }));
  const rewardOutput = reward > 0n ? BigInt(outputs.length) : null;

  if (reward === 0n && rewardTopup !== 0n)
    throw new Error("zero fee batch cannot allocate reward output");

  if (reward > 0n)
    outputs.push(
      output(
        "settler_reward",
        { address: enterprise(rewardKey, "key"), datum: null },
        value([["ada", reward + rewardTopup]]),
      ),
    );

  return { outputs, entries, rewardOutput };
}

/**
 * Settle 1..maxBatch unique Requests, each priced against the same resolved input State.
 * Require supported/funded Request bodies, direction availability, minima and a finite interval
 * ending no later than every deadline; the reward key must satisfy the immutable settler policy.
 * Bound gross issuance/redemption separately, validate the final aggregate successor, and return
 * fixed Claim allocations plus pricingBasis. The result is intent, not measured ledger feasibility.
 */
export function buildBatchPlan(options: BatchOptions): BatchPlan {
  const state = resolveState(options, "ctvs2");
  const { deployment, terms, stateInput, requests, rewardKey } = options;
  const validity = finiteValidity(options.validity),
    rewardTopup = quantity(options.rewardTopup ?? 0n, "reward topup");

  credentialData({ type: "key", hash: rewardKey });

  if (terms.settlers !== null && !terms.settlers.some((settler) => equalHex(settler, rewardKey)))
    throw new Error("unauthorized settler");

  const sorted = sortedReferences(requests, (candidate) => candidate.input.ref);

  if (BigInt(sorted.length) > terms.maxBatch) throw new Error("batch exceeds maxBatch");

  const totals = emptyTotals();
  // No Request observes another Request's intermediate balances or supply.
  const settlements = sorted.map((candidate) => {
    const settlement = settleRequest(
      candidate,
      deployment,
      state,
      stateInput,
      terms,
      validity.upperPosixMs,
    );

    accumulate(totals, settlement);

    return settlement;
  });

  // Newly issued shares in this batch cannot fund its redemptions.
  if (totals.burned > state.economicSupply)
    throw new Error("gross redemption exceeds pre-existing supply");

  const backingDelta = totals.depositedNet - totals.redeemedGross,
    shareDelta = totals.issued - totals.burned;
  const successor = {
    ...state,
    sequence: state.sequence + 1n,
    backingAssets: state.backingAssets + backingDelta,
    economicSupply: state.economicSupply + shareDelta,
    accruedFees: state.accruedFees + totals.fees,
  };

  validateEconomics(successor, terms);

  const { outputs, entries, rewardOutput } = batchOutputLayout(
    options,
    successor,
    settlements,
    totals.reward,
    rewardTopup,
  );
  // A zero net mint removes the policy witness, not the separately checked gross obligations.
  const mint =
    shareDelta === 0n
      ? []
      : [
          {
            policy: deployment.policy,
            assets: { [NAMES.share]: shareDelta },
            redeemer: mintRedeemer({ genesis: false, stateRef: stateInput.ref }),
          },
        ];
  const plan = createPlan({
    operation: "batch",
    deployment,
    inputs: [
      input(
        stateInput.ref,
        "state",
        batchRedeemer({ stateOutput: 0n, entries, rewardKey, rewardOutput }),
      ),
      ...settlements.map((item) =>
        input(item.source.ref, "request", acknowledgeRedeemer(stateInput.ref)),
      ),
    ],
    referenceInputs: [deployment.configRef],
    outputs,
    mint,
    requiredSigners: [rewardKey],
    validity,
  });

  return {
    ...plan,
    operation: "batch",
    pricingBasis: stateInput.ref,
    successor,
    economicEffects: {
      backingDelta,
      shareDelta,
      feeDelta: totals.fees,
      grossSharesIssued: totals.issued,
      grossSharesRedeemed: totals.burned,
      settlerReward: totals.reward,
    },
  };
}
