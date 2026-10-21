/** Recognized Request and Claim views preserve authenticated lineage, unsupported economics and full recovery sources. */
import { assertSameValue, requestValue } from "@ctvs/planning";
import { NAMES, type OutRef, refId } from "@ctvs/protocol";
import { getAddressDetails } from "@lucid-evolution/lucid";
import { protectedMetadata } from "../ledger.js";
import { QueryError } from "../query/schema.js";
import type {
  NetworkBinding,
  Observation,
  Projection,
  RequestRecord,
  VaultRecord,
} from "../types.js";

const known = <T>(value: T): Observation<T> => ({ status: "known", value });

const unknown = (reason: string): Observation<never> => ({ status: "unknown", reason });

/**
 * Classify whether recognized Request economics match this vault's Terms and exact
 * escrow composition. A known result does not promise settlement: current State,
 * bounds, expiry and transaction construction still need their operation checks.
 * Unsupported economics remain an observation so their Recovery path stays visible.
 */
export function requestValidation(record: RequestRecord, vault: VaultRecord): Observation<boolean> {
  try {
    if (!record.request || record.request.body.termsHash !== vault.deployment.termsHash)
      throw new Error("unsupported economics or Terms");

    assertSameValue(record.source.value, requestValue(record.request, vault.terms));

    return known(true);
  } catch (error) {
    return {
      status: "unsupported",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function requestData(projection: Projection, vault: VaultRecord, ref: OutRef) {
  const record = projection.requests.get(refId(ref));

  if (!record || record.policy !== vault.deployment.policy)
    throw new QueryError("NOT_FOUND", "Request has no accepted origin for this vault", 404);

  const participation = requestValidation(record, vault);

  return {
    ...record,
    requestValidation: participation,
    participation: {
      pendingDepositAssetsInBacking: false,
      redemptionEscrowSharesParticipate:
        participation.status === "known" &&
        record.request?.body.kind === "redeem" &&
        record.status === "pending_escrow",
      // Issued SHARE stays in supply even when the surrounding economic body is unsupported.
      escrowedSharesParticipating:
        record.status === "pending_escrow"
          ? (record.source.value[`${vault.deployment.policy}.${NAMES.share}`] ?? 0n)
          : 0n,
      issuedUndeliveredSharesParticipate:
        record.request?.body.kind === "deposit" && record.status === "claimable",
      fixedAssetClaimsParticipate: false,
      settlementRealized: record.settlement !== null,
    },
    recoveryAvailability:
      record.status === "pending_escrow"
        ? known({
            cancel: "controller witness required",
            expiry: "finite validity lower bound at or after deadline",
            deadlinePosixMs: record.recovery.deadlinePosixMs,
            fullSourceValue: record.source.value,
          })
        : { status: "not_applicable", reason: "Request already consumed" },
    delivery: record.settlement
      ? known(projection.claims.get(refId(record.settlement.claimRef)))
      : unknown("not settled"),
  };
}

export function claimData(projection: Projection, vault: VaultRecord, ref: OutRef) {
  const record = projection.claims.get(refId(ref));

  if (!record || record.claim.vaultPolicy !== vault.deployment.policy)
    throw new QueryError(
      "NOT_FOUND",
      "output is not a Claim with authenticated settlement lineage",
      404,
    );

  return record;
}

export function candidateData(
  projection: Projection,
  vault: VaultRecord,
  ref: OutRef,
  network: NetworkBinding,
) {
  const recognized = projection.requests.get(refId(ref));
  const source = recognized?.source ?? projection.utxos.get(refId(ref));

  if (
    !source ||
    getAddressDetails(source.address).paymentCredential?.hash !== vault.deployment.policy
  )
    throw new Error("no candidate at this vault in retained history");

  let recovery: Observation<unknown>;

  try {
    protectedMetadata(source, vault.deployment.policy, network.networkId);

    if (!recognized) throw new Error("unknown or unsupported Request recovery envelope");

    recovery = known(recognized.recovery);
  } catch (error) {
    recovery = {
      status: "unsupported",
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    ref,
    source,
    recovery,
    economics: recognized
      ? requestData(projection, vault, ref).requestValidation
      : { status: "unsupported", reason: "unrecognized recovery envelope" },
    vaultLiability: false,
    classification: recognized ? "recognized_recovery" : "unsupported_recovery",
  };
}
