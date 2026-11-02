/** Shared economic vectors for signed local and isolated node acceptance. */
import type * as p from "@ctvs/protocol";
import { BACKING, RECEIPTS, SUPPLY, VALUE } from "./scripts.js";

/** Cycle distinct queries across every method for the maximum-envelope fixture. */
export function maximumAssertion(index: number): p.PriceAssertion {
  const amount = RECEIPTS + BigInt(index);

  switch (index % 6) {
    case 0:
      return { kind: "ConvertToAssets", shares: amount, assets: (amount * BACKING) / SUPPLY };
    case 1:
      return { kind: "ConvertToShares", assets: amount, shares: (amount * SUPPLY) / BACKING };
    case 2:
      return {
        kind: "PreviewDeposit",
        assetsIn: amount,
        sharesOut: (amount * SUPPLY) / BACKING,
      };
    case 3:
      return {
        kind: "PreviewMint",
        sharesOut: amount,
        assetsIn: (amount * BACKING + SUPPLY - 1n) / SUPPLY,
      };
    case 4:
      return {
        kind: "PreviewWithdraw",
        assetsOut: amount,
        sharesIn: (amount * SUPPLY + BACKING - 1n) / BACKING,
      };
    default:
      return {
        kind: "PreviewRedeem",
        sharesIn: amount,
        assetsOut: (amount * BACKING) / SUPPLY,
      };
  }
}

export const allMethodAssertions: p.PriceAssertion[] = [
  { kind: "ConvertToAssets", shares: RECEIPTS, assets: VALUE },
  { kind: "ConvertToShares", assets: 1n, shares: 90n },
  { kind: "PreviewDeposit", assetsIn: 1n, sharesOut: 90n },
  { kind: "PreviewMint", sharesOut: 100n, assetsIn: 2n },
  { kind: "PreviewWithdraw", assetsOut: 1n, sharesIn: 91n },
  { kind: "PreviewRedeem", sharesIn: 100n, assetsOut: 1n },
];
