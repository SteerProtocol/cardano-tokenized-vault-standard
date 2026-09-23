/** Builds cancellation and expiry refunds from recovery metadata even when Request economics are unsupported. */
import type { AsyncDeployment, ProtectedInput, TimeBounds, TransactionPlan } from "@ctvs/planning";
import {
  assertDeploymentFamily,
  assertProtectedInput,
  createPlan,
  finiteValidity,
  input,
  output,
  ownAsset,
} from "@ctvs/planning";
import {
  assetId,
  type DecodeOptions,
  equalHex,
  type Recovery,
  refundRedeemer,
  requestRecoveryFromCbor,
  requestRecoveryFromData,
} from "@ctvs/protocol";

export interface RefundOptions {
  deployment: AsyncDeployment;
  source: ProtectedInput;
  mode: "cancel" | "expiry";
  validity: TimeBounds;
}
export interface RawRefundSource extends Omit<ProtectedInput, "datum"> {
  datumCbor: string | Uint8Array;
}
export interface RefundCborOptions extends Omit<RefundOptions, "source"> {
  source: RawRefundSource;
  decodeOptions?: DecodeOptions;
}

type RefundMetadata = Omit<RefundOptions, "source"> & {
  source: Omit<ProtectedInput, "datum">;
};

/**
 * Apply common recovery guards after checking the CTVS-2 family and protected source metadata.
 * Reject State/ID custody and a mismatched recovery policy; expiry needs a finite lower bound
 * at or after deadline, while cancellation requires the controller even after expiry.
 * Return the entire actual source value to the refund destination without State/Config inputs,
 * minting or economic repricing. readRecovery chooses semantic or raw-envelope validation.
 */
function refundPlan(options: RefundMetadata, readRecovery: () => Recovery): TransactionPlan {
  const { deployment, source, mode } = options;

  assertDeploymentFamily(deployment, "ctvs2");
  assertProtectedInput(source, deployment.policy);

  const recovery = readRecovery(),
    validity = finiteValidity(options.validity);

  if (!equalHex(recovery.vaultPolicy, deployment.policy)) throw new Error("refund vault mismatch");

  // Recovery is for candidate Requests, never the UTxOs anchoring vault identity or State.
  for (const role of ["state", "id"] as const) {
    if ((source.value[assetId(ownAsset(deployment.policy, role))] ?? 0n) !== 0n)
      throw new Error("protected identity cannot select refund");
  }

  if (mode === "expiry" && validity.lowerPosixMs < recovery.deadlinePosixMs)
    throw new Error("expiry refund before deadline");

  // Controller cancellation remains available after expiry; only the permissionless branch needs the deadline.
  return createPlan({
    operation: mode,
    deployment,
    inputs: [input(source.ref, "request", refundRedeemer(mode, 0n))],
    referenceInputs: [],
    outputs: [output("refund", recovery.refund, source.value)],
    requiredSigners: mode === "cancel" ? [recovery.controller] : [],
    validity,
  });
}

/**
 * Build a refund from already-materialized semantic Request Data using only its Recovery projection.
 * Unsupported economic Data does not prevent cancellation or expiry; source custody is preserved whole.
 * Use buildRefundPlanFromCbor when decoding the economic body itself would exceed SDK budgets.
 * Source existence and script provenance still require independent ledger evidence.
 */
export function buildRefundPlan(options: RefundOptions): TransactionPlan {
  return refundPlan(options, () => requestRecoveryFromData(options.source.datum).recovery);
}

/**
 * Build the same refund directly from raw inline Request CBOR without interpreting economics.
 * decodeOptions bounds the complete input bytes and projected fields as documented by
 * requestRecoveryFromCbor; the generic parser still validates framing and has runtime limits.
 * The raw source is not rewritten, and all family, custody, controller/deadline guards still apply.
 */
export function buildRefundPlanFromCbor(options: RefundCborOptions): TransactionPlan {
  return refundPlan(
    options,
    () => requestRecoveryFromCbor(options.source.datumCbor, options.decodeOptions).recovery,
  );
}
