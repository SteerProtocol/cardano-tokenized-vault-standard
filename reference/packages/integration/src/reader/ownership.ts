/** Ownership partitions over one published projection; controller, refund owner and receiver stay distinct. */
import {
  type Address,
  addressData,
  assetId,
  equalData,
  NAMES,
  type OutRef,
  refId,
} from "@ctvs/protocol";
import { getAddressDetails } from "@lucid-evolution/lucid";
import type { Projection, VaultRecord } from "../types.js";
import { requestValidation } from "./lifecycle.js";

/**
 * Match payment and stake credentials for the Address forms this profile represents.
 * Pointer and other address forms return false rather than collapsing an unresolved
 * stake reference into an enterprise address. Network provenance comes from the feed.
 */
function sameAddress(bech32: string, address: Address): boolean {
  const actual = getAddressDetails(bech32);

  if (actual.type !== "Base" && actual.type !== "Enterprise") return false;

  const credential = (a: { type: string; hash: string } | undefined, b: Address["stake"]) =>
    b === null ? !a : a?.type.toLowerCase() === b.type && a.hash === b.hash.toLowerCase();

  return (
    credential(actual.paymentCredential, address.payment) &&
    credential(actual.stakeCredential, address.stake)
  );
}

/**
 * Sum observed unspent SHARE at the complete owner address, excluding tracked escrow
 * and Claims that are reported separately. Zero means none in the retained projection,
 * not proof that an arbitrary wallet has no holdings outside the replayed history.
 */
function freeShareBalance(projection: Projection, owner: Address, unit: string): bigint {
  let freeShares = 0n;

  for (const utxo of projection.utxos.values())
    if (
      sameAddress(utxo.address, owner) &&
      !projection.claims.has(refId(utxo.ref)) &&
      !projection.requests.has(refId(utxo.ref))
    )
      freeShares += utxo.value[unit] ?? 0n;

  return freeShares;
}

/**
 * Keep cancellation authority separate from the destination entitled to a refund.
 * A matching controller can be reported even when a different address receives funds.
 * Only pending Requests with supported, correctly funded economics enter asset/share
 * subtotals; unsupported Requests for the refund owner are counted without a valuation.
 */
function pendingRequestOwnership(
  projection: Projection,
  vault: VaultRecord,
  owner: Address,
): {
  lockedRedemptionShares: bigint;
  pendingDepositAssets: bigint;
  unsupportedRequests: number;
  controlledRequests: OutRef[];
} {
  const controlledRequests: OutRef[] = [];
  let lockedRedemptionShares = 0n,
    pendingDepositAssets = 0n,
    unsupportedRequests = 0;

  for (const request of projection.requests.values()) {
    if (request.policy !== vault.deployment.policy || request.status !== "pending_escrow") continue;

    if (
      owner.payment.type === "key" &&
      request.recovery.controller === owner.payment.hash.toLowerCase()
    )
      controlledRequests.push(request.ref);

    if (!equalData(addressData(request.recovery.refund.address), addressData(owner))) continue;

    const participation = requestValidation(request, vault);

    if (!request.request || participation.status !== "known") {
      unsupportedRequests++;
      continue;
    }

    if (request.request.body.kind === "deposit")
      pendingDepositAssets += request.request.body.offered;
    else lockedRedemptionShares += request.request.body.offered;
  }

  return { lockedRedemptionShares, pendingDepositAssets, unsupportedRequests, controlledRequests };
}

/**
 * Aggregate authenticated, undelivered Claims by their recorded receiver, which can
 * differ from the original controller and refund destination. Issued SHARE remains
 * part of economic supply while escrowed here; fixed asset Claims have already exited.
 * Use economicQuantity so carried storage lovelace is not counted as an entitlement.
 */
function undeliveredClaimOwnership(
  projection: Projection,
  vault: VaultRecord,
  owner: Address,
  unit: string,
): { issuedUndeliveredShares: bigint; fixedAssetClaims: bigint } {
  let issuedUndeliveredShares = 0n,
    fixedAssetClaims = 0n;

  for (const record of projection.claims.values()) {
    if (record.delivered || record.claim.vaultPolicy !== vault.deployment.policy) continue;

    const destination = record.claim.receiver.address;

    if (!equalData(addressData(destination), addressData(owner))) continue;

    if (assetId(record.claim.asset) === unit)
      issuedUndeliveredShares += record.claim.economicQuantity;
    else fixedAssetClaims += record.claim.economicQuantity;
  }

  return { issuedUndeliveredShares, fixedAssetClaims };
}

export function ownershipData(projection: Projection, vault: VaultRecord, owner: Address) {
  const unit = `${vault.deployment.policy}.${NAMES.share}`;
  const freeShares = freeShareBalance(projection, owner, unit);
  const { lockedRedemptionShares, pendingDepositAssets, unsupportedRequests, controlledRequests } =
    pendingRequestOwnership(projection, vault, owner);
  const { issuedUndeliveredShares, fixedAssetClaims } = undeliveredClaimOwnership(
    projection,
    vault,
    owner,
    unit,
  );

  return {
    freeShares,
    lockedRedemptionShares,
    issuedUndeliveredShares,
    pendingDepositAssets,
    fixedAssetClaims,
    unsupportedRequests,
    controlledRequests,
    pendingEntitlement: "refund_destination",
    scope: "accepted history since authenticated genesis",
  };
}
