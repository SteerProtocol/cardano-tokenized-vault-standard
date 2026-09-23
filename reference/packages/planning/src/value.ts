/** Closed custody equations aggregate ADA collisions while retaining separate economic/reserve fields. */
import type { Asset, Claim, Request, State, Terms } from "@ctvs/protocol";
import { assetId, NAMES, quantity } from "@ctvs/protocol";
import type { Value } from "./types.js";

/**
 * Build a new canonical custody map from Asset/base-unit pairs, merging repeated identities.
 * Zero quantities disappear; each input and each merged total must fit 0..Q_MAX.
 * This deliberately merges ADA economic and reserve partitions while their semantic fields stay separate.
 * Negative mint/burn deltas are not custody values and must not pass through this helper.
 */
export function value(entries: readonly (readonly [Asset, bigint])[]): Value {
  const result: Value = {};

  for (const [asset, amount] of entries) {
    const id = assetId(asset);

    quantity(amount, `value ${id}`);

    if (amount > 0n) result[id] = quantity((result[id] ?? 0n) + amount, `aggregate value ${id}`);
  }

  return result;
}

export function ownAsset(policy: string, name: keyof typeof NAMES): Asset {
  return { policy, name: NAMES[name] };
}

/**
 * Compute the closed State custody map: backing plus fees in the underlying asset,
 * storage reserve in lovelace, and exactly one STATE token.
 * ADA underlying merges the first two quantities physically; reserves and fees still do not buy shares.
 * This builds expected value, not proof that a supplied State UTxO holds it.
 */
export function stateValue(state: State, terms: Terms): Value {
  return value([
    ["ada", state.storageLovelace],
    [terms.underlying, state.backingAssets + state.accruedFees],
    [ownAsset(state.vaultPolicy, "state"), 1n],
  ]);
}

/**
 * Compute exact pending escrow: offered underlying for deposits or offered SHARE for redemptions,
 * plus storageLovelace and executionBudget in ADA. The settler fee is already inside that budget.
 * ADA deposits merge reserves and the offered amount physically, without adding pending assets
 * to priced vault backing. Body/schema validation is the caller's responsibility.
 */
export function requestValue(request: Request, terms: Terms): Value {
  const economicAsset =
    request.body.kind === "deposit"
      ? terms.underlying
      : ownAsset(request.recovery.vaultPolicy, "share");

  return value([
    ["ada", request.body.storageLovelace + request.body.executionBudget],
    [economicAsset, request.body.offered],
  ]);
}

/**
 * Compute funded Claim liability plus carried ADA, merging them when the Claim asset is ADA.
 * Each physical total is bounded through value(). This is the expected settlement allocation;
 * delivery/refund paths use actual source custody so independently added surplus is not discarded.
 */
export function claimValue(claim: Claim): Value {
  return value([
    ["ada", claim.carriedLovelace],
    [claim.asset, claim.economicQuantity],
  ]);
}

/**
 * Validate a source custody map and return a new copy with zero entries removed.
 * Keys must already be lowercase "ada" or policyHex.assetNameHex; malformed or odd-length names throw.
 * Every quantity is nonnegative and bounded. Extra nonzero assets are retained so later closed-value
 * checks can reject them, and signed mint/burn quantities are intentionally unsupported.
 */
export function actualValue(input: Value): Value {
  const result: Value = {};

  for (const [id, amount] of Object.entries(input)) {
    if (id !== "ada") {
      const match = /^([a-f0-9]{56})\.([a-f0-9]{0,64})$/.exec(id);

      if (!match || (match[2]?.length ?? 1) % 2 !== 0)
        throw new Error("invalid value asset identifier");
    }

    quantity(amount, "actual input quantity");

    if (amount > 0n) result[id] = amount;
  }

  return result;
}

/**
 * Require exact custody equality after validating and dropping zero entries from the actual map.
 * The expected map must already be canonical and zero-free, normally produced by value().
 * Neither deficits nor surplus assets are accepted; this does not normalize or mutate the expected map.
 */
export function assertSameValue(actual: Value, expected: Value): void {
  const normalized = actualValue(actual);

  if (
    Object.keys(normalized).length !== Object.keys(expected).length ||
    Object.entries(expected).some(([id, amount]) => normalized[id] !== amount)
  ) {
    throw new Error("source value does not match closed accounting equation");
  }
}
