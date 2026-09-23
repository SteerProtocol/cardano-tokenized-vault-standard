/** Maintenance intents change one State while preserving backing/share accounting and immutable Terms. */
import type { PlutusData, State } from "@ctvs/protocol";
import {
  collectFeesRedeemer,
  integer,
  positive,
  quantity,
  setPauseRedeemer,
  stateData,
  topUpRedeemer,
  validateEconomics,
} from "@ctvs/protocol";
import { resolveState, scriptDestination } from "./context.js";
import { createPlan, input, output } from "./plan.js";
import type {
  CollectFeesOptions,
  ImplementationFamily,
  PlannedOutput,
  SetPauseOptions,
  StateContext,
  TopUpOptions,
  TransactionPlan,
} from "./types.js";
import { stateValue, value } from "./value.js";

/**
 * Assemble a maintenance successor at output 0 with the immutable Config as a reference input.
 * Callers must first resolve the old State and choose the operation-specific fields and redeemer.
 * Revalidate successor economics, then append any payout outputs and signer requirements;
 * no share minting, external funding selection or chain mutation occurs here.
 */
function planStateChange(
  context: StateContext,
  successor: State,
  operation: "collect_fees" | "top_up_reserve" | "set_pause",
  redeemer: PlutusData,
  extraOutputs: PlannedOutput[] = [],
  signers: string[] = [],
): TransactionPlan {
  validateEconomics(successor, context.terms);

  return createPlan({
    operation,
    deployment: context.deployment,
    inputs: [input(context.stateInput.ref, "state", redeemer)],
    referenceInputs: [context.deployment.configRef],
    outputs: [
      output(
        "state",
        scriptDestination(context.deployment.policy),
        stateValue(successor, context.terms),
        stateData(successor),
      ),
      ...extraOutputs,
    ],
    requiredSigners: signers,
  });
}

/**
 * Collect all positive accrued fees to the immutable fee destination and reset that partition to zero.
 * Backing, supply and State reserve stay unchanged; sequence advances once.
 * Optional receiverTopup is external lovelace, including for ADA underlying. A zero fee balance throws;
 * this maintenance path does not require an entry/exit capability or an unpaused trading direction.
 */
export function createCollectFeesPlan(
  family: ImplementationFamily,
  options: CollectFeesOptions,
): TransactionPlan {
  const state = resolveState(options, family),
    topup = quantity(options.receiverTopup ?? 0n, "fee receiver topup");

  positive(state.accruedFees, "collectible fees");

  const successor = { ...state, sequence: state.sequence + 1n, accruedFees: 0n };
  const payout = output(
    "fees",
    options.terms.feeDestination,
    value([
      [options.terms.underlying, state.accruedFees],
      ["ada", topup],
    ]),
  );

  return planStateChange(options, successor, "collect_fees", collectFeesRedeemer(0n, 1n), [payout]);
}

/**
 * Add a strictly positive external lovelace amount to State storage reserve and advance sequence.
 * Backing, fees and share supply stay unchanged even when the underlying asset is ADA.
 * Reject successor overflow; the planner does not select the wallet inputs funding the addition.
 */
export function createTopUpPlan(
  family: ImplementationFamily,
  options: TopUpOptions,
): TransactionPlan {
  const state = resolveState(options, family);

  positive(options.additionalLovelace, "additional reserve");

  const successor = {
    ...state,
    sequence: state.sequence + 1n,
    storageLovelace: state.storageLovelace + options.additionalLovelace,
  };

  return planStateChange(
    options,
    successor,
    "top_up_reserve",
    topUpRedeemer(options.additionalLovelace, 0n),
  );
}

/**
 * Replace directional pause flags with a value in 0..3 and advance State sequence.
 * Require the immutable pause key as a transaction signer; null disables this operation.
 * Capability bits and economic partitions remain unchanged. The intent requires a witness
 * but does not prove possession of the key or produce that witness.
 */
export function createSetPausePlan(
  family: ImplementationFamily,
  options: SetPauseOptions,
): TransactionPlan {
  const state = resolveState(options, family);

  integer(options.pauseFlags, "pause flags", 0n, 3n);

  if (options.terms.pauseKey === null) throw new Error("pause authority disabled");

  const successor = { ...state, sequence: state.sequence + 1n, pauseFlags: options.pauseFlags };

  return planStateChange(
    options,
    successor,
    "set_pause",
    setPauseRedeemer(options.pauseFlags, 0n),
    [],
    [options.terms.pauseKey],
  );
}
