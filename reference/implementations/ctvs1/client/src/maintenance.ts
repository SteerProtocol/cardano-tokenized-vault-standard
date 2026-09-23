/** CTVS-1 maintenance shares accounting primitives without importing asynchronous transaction paths. */
import type {
  CollectFeesOptions,
  SetPauseOptions,
  SyncDeployment,
  TopUpOptions,
  TransactionPlan,
} from "@ctvs/planning";
import { createCollectFeesPlan, createSetPausePlan, createTopUpPlan } from "@ctvs/planning";
export interface SyncCollectFeesOptions extends CollectFeesOptions {
  deployment: SyncDeployment;
}
export interface SyncTopUpOptions extends TopUpOptions {
  deployment: SyncDeployment;
}
export interface SyncSetPauseOptions extends SetPauseOptions {
  deployment: SyncDeployment;
}

/**
 * Collect all accrued underlying fees from a resolved CTVS1 State to immutable feeDestination.
 * Receiver ADA top-up is external funding; backing and supply are unchanged.
 * Returns the shared maintenance intent with this family's runtime binding checks.
 */
export function buildCollectFeesPlan(options: SyncCollectFeesOptions): TransactionPlan {
  return createCollectFeesPlan("ctvs1", options);
}

/**
 * Add positive external lovelace to a resolved CTVS1 storage reserve, without minting shares.
 * Reserve growth is not priced backing even for ADA underlying.
 * The shared planner bounds the successor; wallet funding remains unresolved.
 */
export function buildTopUpReservePlan(options: SyncTopUpOptions): TransactionPlan {
  return createTopUpPlan("ctvs1", options);
}

/**
 * Plan a CTVS1 directional pause-flag update requiring the immutable pause-key witness.
 * Flags replace the current value in 0..3; null pause authority rejects the operation.
 * No capability bits or economic partitions change, and this intent does not supply a signature.
 */
export function buildSetPausePlan(options: SyncSetPauseOptions): TransactionPlan {
  return createSetPausePlan("ctvs1", options);
}
