/** Optional Price version 1 claims, independent of the direct-custody WIRE-2 actions. */
import type { Asset, PlutusData } from "../types.js";

/** Input-first quantities are ledger units; a typed claim is not verified valuation. */
export type PriceAssertion =
  | { kind: "ConvertToAssets"; shares: bigint; assets: bigint }
  | { kind: "ConvertToShares"; assets: bigint; shares: bigint }
  | { kind: "PreviewDeposit"; assetsIn: bigint; sharesOut: bigint }
  | { kind: "PreviewMint"; sharesOut: bigint; assetsIn: bigint }
  | { kind: "PreviewWithdraw"; assetsOut: bigint; sharesIn: bigint }
  | { kind: "PreviewRedeem"; sharesIn: bigint; assetsOut: bigint };

/** Evidence interpretation, provider approval and economic truth belong to the provider binding. */
export interface Price {
  version: bigint;
  marketId: Asset;
  shareAsset: Asset;
  underlyingAsset: Asset;
  assertions: PriceAssertion[];
  evidence: PlutusData;
}
