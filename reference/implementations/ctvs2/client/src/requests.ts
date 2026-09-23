/** Creates independently funded Request candidates; settlement later determines their economic outcome. */
import type { FamilyContext, TransactionPlan } from "@ctvs/planning";
import { assertContext, createPlan, output, requestValue, scriptDestination } from "@ctvs/planning";
import type { Request } from "@ctvs/protocol";
import { equalHex, requestData } from "@ctvs/protocol";

export interface RequestOptions extends FamilyContext<"ctvs2"> {
  request: Request;
}
export interface RequestPlan extends TransactionPlan {
  operation: "create_request";
  participation: "pending_assets_excluded_from_backing" | "escrowed_shares_still_participate";
  attribution: "candidate_creation_does_not_authenticate_named_controller";
  requestId: { status: "unknown_until_transaction_exists" };
}

/**
 * Create a funded-candidate intent for an enabled CTVS-2 deposit or redemption direction.
 * Check supplied family/Terms bindings and body reserves, but do not consume State, quote execution
 * or inspect current pause flags. Settlement later applies snapshot price, deadline and minimum checks.
 * Naming a controller does not authenticate that key; the Request ID is unknown until the actual
 * transaction output exists. The returned participation labels describe accounting, not acceptance.
 */
export function buildRequestPlan(options: RequestOptions): RequestPlan {
  assertContext(options, "ctvs2");

  const { deployment, terms, request } = options,
    datum = requestData(request);

  if (
    !equalHex(request.recovery.vaultPolicy, deployment.policy) ||
    !equalHex(request.body.termsHash, deployment.termsHash)
  )
    throw new Error("request deployment mismatch");

  const requiredMode = request.body.kind === "deposit" ? 4n : 8n;

  if ((terms.executionModes & requiredMode) === 0n) throw new Error("request direction disabled");

  return {
    ...createPlan({
      operation: "create_request",
      deployment,
      inputs: [],
      referenceInputs: [deployment.configRef],
      outputs: [
        output(
          "request",
          scriptDestination(deployment.policy),
          requestValue(request, terms),
          datum,
        ),
      ],
    }),
    operation: "create_request",
    participation:
      request.body.kind === "deposit"
        ? "pending_assets_excluded_from_backing"
        : "escrowed_shares_still_participate",
    attribution: "candidate_creation_does_not_authenticate_named_controller",
    // A Request is identified by its eventual output reference, so its datum cannot name itself.
    requestId: { status: "unknown_until_transaction_exists" },
  };
}
