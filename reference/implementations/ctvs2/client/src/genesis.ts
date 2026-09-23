/** Keeps the asynchronous deployment and Claim-script binding explicit at the shared genesis boundary. */
import type { AsyncDeployment, GenesisOptions, TransactionPlan } from "@ctvs/planning";
import { createGenesisPlan } from "@ctvs/planning";
export interface AsyncGenesisOptions extends GenesisOptions {
  deployment: AsyncDeployment;
}

/**
 * Build the CTVS2 initialization intent through the common genesis accounting.
 * Require that family's deployment shape, validated Terms and positive Config/State ADA reserves.
 * The seed and script metadata remain caller-supplied; this wrapper does not derive the policy
 * or establish a live deployment before the planned transaction is built and accepted.
 */
export function buildGenesisPlan(options: AsyncGenesisOptions): TransactionPlan {
  return createGenesisPlan("ctvs2", options);
}
