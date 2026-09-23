/** Request settlement, recovery and Claim codecs share envelopes but enforce different body contracts. */
import { bytes, constr as C, constructorIndex, isConstr } from "../data/index.js";
import { positive, quantity as q } from "../math/integer.js";
import type {
  Claim,
  DataConstr,
  PlutusData,
  RecoverableRequest,
  Recovery,
  Request,
  RequestBody,
} from "../types.js";
import {
  assetData,
  assetFromData,
  b28,
  b32,
  destinationData,
  destinationFromData,
  fields,
  MAGIC,
  outRefData,
  outRefFromData,
  readBytes,
  sized,
  version,
} from "./primitives.js";

/**
 * Encode the recovery contract independently of the Request's economic body.
 * Require a vault policy, key controller, bounded refund destination and positive POSIX-ms deadline.
 * These are datum claims; encoding does not authenticate the controller or escrow origin.
 */
export function recoveryData(recovery: Recovery): DataConstr {
  return C(0, [
    b28(recovery.vaultPolicy),
    C(0, [b28(recovery.controller)]),
    destinationData(recovery.refund),
    positive(recovery.deadlinePosixMs, "deadline"),
  ]);
}

/**
 * Decode the supported Recovery constructor with a key-only controller and exact field shapes.
 * Normalize policy/controller bytes and validate the refund destination and positive deadline.
 * No Terms, current State, Request value or economic eligibility is needed for this projection.
 */
export function recoveryFromData(data: PlutusData): Recovery {
  const [policy, controller, refund, deadline] = fields(data, 0, 4, "Recovery");

  return {
    vaultPolicy: readBytes(policy, 28),
    controller: readBytes(fields(controller, 0, 1, "Controller")[0], 28),
    refund: destinationFromData(refund),
    deadlinePosixMs: positive(deadline, "deadline"),
  };
}

/**
 * Encode supported deposit/redeem settlement intent with positive offered/minimum quantities.
 * Storage and execution allocations are lovelace; settlerFee must not exceed executionBudget,
 * and their reserve sum must fit Q_MAX. Offered/minimum units depend on the request kind.
 * This body check does not prove matching deployment Terms or sufficient actual escrow custody.
 */
export function requestBodyData(body: RequestBody): DataConstr {
  if (body.kind !== "deposit" && body.kind !== "redeem")
    throw new Error("unsupported Request kind");

  if (q(body.settlerFee) > q(body.executionBudget))
    throw new RangeError("settler fee exceeds execution budget");

  q(body.storageLovelace + body.executionBudget, "aggregate Request reserve");

  return C(0, [
    b32(body.termsHash),
    C(body.kind === "deposit" ? 0 : 1),
    positive(body.offered),
    positive(body.minimumOutput),
    destinationData(body.receiver),
    positive(body.storageLovelace, "Request reserve"),
    q(body.executionBudget),
    q(body.settlerFee),
  ]);
}

/**
 * Decode the exact eight-field economic body and supported deposit/redeem kind.
 * Re-run requestBodyData to check fee allocation, quantity and destination constraints.
 * Unsupported economics throw here even when the surrounding Recovery remains usable.
 */
export function requestBodyFromData(data: PlutusData): RequestBody {
  const f = fields(data, 0, 8, "RequestBody"),
    kind = f[1];

  if (
    !isConstr(kind) ||
    (constructorIndex(kind.constr) !== 0n && constructorIndex(kind.constr) !== 1n)
  )
    throw new Error("unsupported Request kind");

  fields(kind, kind.constr, 0, "Request kind");

  const result: RequestBody = {
    termsHash: readBytes(f[0], 32),
    kind: constructorIndex(kind.constr) === 0n ? "deposit" : "redeem",
    offered: positive(f[2]),
    minimumOutput: positive(f[3]),
    receiver: destinationFromData(f[4]),
    storageLovelace: positive(f[5]),
    executionBudget: q(f[6]),
    settlerFee: q(f[7]),
  };

  requestBodyData(result);

  return result;
}

/**
 * Encode a fully supported WIRE-2 Request with separate Recovery and economic-body fields.
 * Both projections must validate and the whole preferred encoding must fit 4,096 bytes.
 * This settlement-oriented bound must not be reused to deny independent recovery of an
 * otherwise supported envelope containing unsupported or oversized economic Data.
 */
export function requestData(request: Request): DataConstr {
  return sized(
    C(1, [bytes(MAGIC), 2n, recoveryData(request.recovery), requestBodyData(request.body)]),
    4096,
    "Request",
  );
}

/**
 * Project supported Recovery from an already-materialized semantic Request envelope.
 * Check only outer role/arity/version and Recovery fields; return economicBody unchanged.
 * No settlement-body interpretation or full-Request size cap is applied. To avoid materializing
 * a hostile economic body in the first place, use requestRecoveryFromCbor on the original bytes.
 */
export function requestRecoveryFromData(data: PlutusData): RecoverableRequest {
  const [magic, wireVersion, recovery, economicBody] = fields(data, 1, 4, "Request");

  version(magic, wireVersion);

  return { recovery: recoveryFromData(recovery), economicBody };
}

/**
 * Decode a Request for settlement, requiring supported Recovery and economic-body schemas.
 * Validate the normalized full Request size and body allocations by rebuilding requestData.
 * This cannot establish deployed Terms equality, actual funding, current pause flags or deadline
 * eligibility; the settlement planner checks those against its snapshot and validity interval.
 */
export function requestFromData(data: PlutusData): Request {
  const projected = requestRecoveryFromData(data);
  const result = {
    recovery: projected.recovery,
    body: requestBodyFromData(projected.economicBody),
  };

  requestData(result);

  return result;
}

/**
 * Encode a positive fixed Claim liability, its Request/State references and receiver destination.
 * Require positive carried lovelace, bound combined ADA liability and reserve when applicable,
 * and cap the preferred encoding at 2,048 bytes. Stored lineage references are data claims;
 * the creating settlement transaction is what establishes their provenance.
 */
export function claimData(claim: Claim): DataConstr {
  if (claim.asset === "ada")
    q(claim.economicQuantity + claim.carriedLovelace, "aggregate Claim ADA");

  return sized(
    C(2, [
      bytes(MAGIC),
      2n,
      b28(claim.vaultPolicy),
      outRefData(claim.requestRef),
      outRefData(claim.stateRef),
      b32(claim.termsHash),
      assetData(claim.asset),
      positive(claim.economicQuantity),
      destinationData(claim.receiver),
      positive(claim.carriedLovelace, "Claim reserve"),
    ]),
    2048,
    "Claim",
  );
}

/**
 * Decode exact Claim role/arity/version, normalize identifiers and validate amounts/destination.
 * Re-run claimData for combined ADA and preferred-size bounds.
 * This does not authenticate settlement lineage or custody; a copied Claim datum is insufficient
 * evidence of a vault liability. Delivery planning also needs the actual source value.
 */
export function claimFromData(data: PlutusData): Claim {
  const f = fields(data, 2, 10, "Claim");

  version(f[0], f[1]);

  const result: Claim = {
    vaultPolicy: readBytes(f[2], 28),
    requestRef: outRefFromData(f[3]),
    stateRef: outRefFromData(f[4]),
    termsHash: readBytes(f[5], 32),
    asset: assetFromData(f[6]),
    economicQuantity: positive(f[7]),
    receiver: destinationFromData(f[8]),
    carriedLovelace: positive(f[9]),
  };

  claimData(result);

  return result;
}
