/** CTVS-2 maintenance uses the shared fee, reserve and pause accounting with asynchronous family checks. */
import type {
  AsyncDeployment,
  CollectFeesOptions,
  SetPauseOptions,
  TopUpOptions,
  TransactionPlan,
} from "@ctvs/planning";
import { createCollectFeesPlan, createSetPausePlan, createTopUpPlan } from "@ctvs/planning";
export interface AsyncCollectFeesOptions extends CollectFeesOptions {
  deployment: AsyncDeployment;
}
export interface AsyncTopUpOptions extends TopUpOptions {
  deployment: AsyncDeployment;
}
export interface AsyncSetPauseOptions extends SetPauseOptions {
  deployment: AsyncDeployment;
}

/**
 * Collect all accrued underlying fees from a resolved CTVS2 State to immutable feeDestination.
 * Receiver ADA top-up is external funding; backing and supply are unchanged.
 * Returns the shared maintenance intent with this family's runtime binding checks.
 */
export function buildCollectFeesPlan(options: AsyncCollectFeesOptions): TransactionPlan {
  return createCollectFeesPlan("ctvs2", options);
}

/**
 * Add positive external lovelace to a resolved CTVS2 storage reserve, without minting shares.
 * Reserve growth is not priced backing even for ADA underlying.
 * The shared planner bounds the successor; wallet funding remains unresolved.
 */
export function buildTopUpReservePlan(options: AsyncTopUpOptions): TransactionPlan {
  return createTopUpPlan("ctvs2", options);
}

/**
 * Plan a CTVS2 directional pause-flag update requiring the immutable pause-key witness.
 * Flags replace the current value in 0..3; null pause authority rejects the operation.
 * No capability bits or economic partitions change, and this intent does not supply a signature.
 */
export function buildSetPausePlan(options: AsyncSetPauseOptions): TransactionPlan {
  return createSetPausePlan("ctvs2", options);
}
