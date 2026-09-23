/** Delivers existing Claim custody without repricing, minting, or consuming vault State. */
import type { AsyncDeployment, ProtectedInput, TransactionPlan } from "@ctvs/planning";
import {
  assertDeploymentFamily,
  assertProtectedInput,
  createPlan,
  input,
  output,
} from "@ctvs/planning";
import { claimFromData, deliverRedeemer, sortedReferences } from "@ctvs/protocol";

export interface DeliveryOptions {
  deployment: AsyncDeployment;
  claims: ProtectedInput[];
}

/**
 * Build permissionless delivery of 1..16 Claims with no State input, Config reference or mint.
 * Require protected Claim-script inputs and supported Claim datums, then send each full actual
 * source value, including surplus, to its datum receiver. All spends share one exhaustive redeemer.
 * This planner checks supplied metadata, not authenticated settlement lineage or live UTxO existence.
 */
export function buildDeliverPlan({ deployment, claims }: DeliveryOptions): TransactionPlan {
  assertDeploymentFamily(deployment, "ctvs2");

  const sorted = sortedReferences(claims, (claim) => claim.ref);
  // Every consumed Claim carries the same exhaustive list with distinct receiver output indices.
  const entries = sorted.map((claim, index) => ({
      claimRef: claim.ref,
      receiverOutput: BigInt(index),
    })),
    redeemer = deliverRedeemer(entries);
  const outputs = sorted.map((source) => {
    assertProtectedInput(source, deployment.claimScript);

    const claim = claimFromData(source.datum);

    return output("delivery", claim.receiver, source.value);
  });

  return createPlan({
    operation: "deliver",
    deployment,
    inputs: sorted.map((source) => input(source.ref, "claim", redeemer)),
    referenceInputs: [],
    outputs,
  });
}
