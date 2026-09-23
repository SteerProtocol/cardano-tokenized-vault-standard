/** Keeps CTVS-1 deployment binding explicit while sharing the common genesis accounting. */
import type { GenesisOptions, SyncDeployment, TransactionPlan } from "@ctvs/planning";
import { createGenesisPlan } from "@ctvs/planning";
export interface SyncGenesisOptions extends GenesisOptions {
  deployment: SyncDeployment;
}

/**
 * Build the CTVS1 initialization intent through the common genesis accounting.
 * Require that family's deployment shape, validated Terms and positive Config/State ADA reserves.
 * The seed and script metadata remain caller-supplied; this wrapper does not derive the policy
 * or establish a live deployment before the planned transaction is built and accepted.
 */
export function buildGenesisPlan(options: SyncGenesisOptions): TransactionPlan {
  return createGenesisPlan("ctvs1", options);
}
