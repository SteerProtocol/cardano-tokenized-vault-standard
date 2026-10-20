/** Independent test custody equations keep economic tokens separate from externally funded lovelace. */
import type { EconomicView } from "@ctvs/integration/query";
import { assetId, NAMES, type State } from "@ctvs/protocol";
import { expect } from "vitest";
import { write } from "./environment.js";
import type { Flow } from "./flow.js";

export const economicQueries = {
  convertToAssets: { shares: 1000000n },
  convertToShares: { assets: 1000000n },
  previewDeposit: { assets: 101000000n, include: ["construction"] as const },
  previewMint: { shares: 100000000n },
  previewWithdraw: { assets: 9900000n },
  previewRedeem: { shares: 10000000n },
};

export function underlyingValue(f: Flow, amount: bigint, lovelace: bigint): Record<string, bigint> {
  const value: Record<string, bigint> = { ada: lovelace };
  const unit = assetId(f.installed.terms.underlying);

  if (amount > 0n) value[unit] = (value[unit] ?? 0n) + amount;

  return value;
}

export function stateCustody(f: Flow, state: State): Record<string, bigint> {
  return {
    ...underlyingValue(f, state.backingAssets + state.accruedFees, state.storageLovelace),
    [`${f.installed.deployment.policy}.${NAMES.state}`]: 1n,
  };
}

export function economicUnits(f: Flow, view: EconomicView): void {
  expect(view.units).toEqual({
    assets: f.installed.terms.underlying,
    shares: `${f.installed.deployment.policy}.${NAMES.share}`,
  });
  expect(view.feeUnits).toEqual({
    protocol: f.installed.terms.underlying,
    network: "lovelace",
    settler: "lovelace",
    executionCharge: "lovelace",
    storage: "lovelace",
    topups: "lovelace",
  });
}

/** At the final frozen point, all underlying is either in the owner's wallet or the authenticated State. */
export async function nativeInventory(f: Flow, reserve = 10000000n): Promise<void> {
  if (f.installed.terms.underlying === "ada") return;

  f.w.selectOwner();

  const underlying = assetId(f.installed.terms.underlying);
  const unit = underlying.replace(".", "");
  const outputs = await f.w.lucid.wallet().getUtxos();
  const context = (await f.vault.context()).data;
  const wallet = outputs.reduce((total, output) => total + (output.assets[unit] ?? 0n), 0n);
  const unrelated = outputs.reduce(
    (total, output) => total + (output.assets[f.installed.unit] ?? 0n),
    0n,
  );
  const custody = context.stateInput.value[underlying] ?? 0n;

  expect(wallet + custody).toBe(9007199254740993n);
  expect(unrelated).toBe(9007199254740993n);
  expect(context.stateInput.value.ada).toBe(reserve);
  expect(
    context.stateInput.value[`${f.installed.unit.slice(0, 56)}.${f.installed.unit.slice(56)}`],
  ).toBeUndefined();
  write(f.env.directory, "native-inventory", {
    underlying,
    unrelatedUnit: f.installed.unit,
    initial: 9007199254740993n,
    wallet,
    state: custody,
    unrelatedWallet: unrelated,
    lovelaceReserve: context.stateInput.value.ada,
  });
}
