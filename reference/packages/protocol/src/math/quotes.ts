/** Snapshot arithmetic keeps backing, fees and storage reserves distinct when deriving share price. */
import type { Operation, Quote, Rounding, State, Terms } from "../types.js";
import { BPS, ceilDiv, feeRaw, feeTotal, integer, positive, quantity } from "./integer.js";

/**
 * Check profile-0 numeric bounds, backing cap and the aggregate physical custody quantity.
 * Return the virtual price ratio x = backing + 1 and y = supply + virtualShares;
 * fees and storage reserves are excluded from price, while ADA custody merges those partitions.
 * This validates supplied numbers, not Terms commitments, execution eligibility or actual UTxOs.
 */
export function validateEconomics(state: State, terms: Terms) {
  for (const key of [
    "backingAssets",
    "economicSupply",
    "accruedFees",
    "storageLovelace",
    "sequence",
  ] as const)
    quantity(state[key], key);

  positive(state.storageLovelace, "storageLovelace");
  integer(state.pauseFlags, "pauseFlags", 0n, 3n);
  integer(terms.profile, "profile", 0n, 0n);
  positive(terms.virtualShares, "virtualShares");
  integer(terms.entryBps, "entryBps", 0n, 9999n);
  integer(terms.exitBps, "exitBps", 0n, 9999n);
  integer(terms.executionModes, "executionModes", 1n, 15n);

  if (terms.maxBacking !== null) {
    quantity(terms.maxBacking, "maxBacking");

    if (state.backingAssets > terms.maxBacking) throw new RangeError("backing exceeds cap");
  }

  // ADA backing shares a ledger quantity with fees and reserve; native backing does not.
  quantity(
    state.backingAssets +
      state.accruedFees +
      (terms.underlying === "ada" ? state.storageLovelace : 0n),
    "aggregate custody",
  );

  return { x: state.backingAssets + 1n, y: state.economicSupply + terms.virtualShares };
}

/**
 * Convert underlying-asset base units to share units at the supplied virtualized snapshot.
 * Use floor(assets * y / x) by default, or its ceiling when rounding is "up".
 * Input and result must fit 0..Q_MAX. Fees, pause/mode checks and user bounds are not applied;
 * the caller chooses rounding appropriate to its operation. Zero conversion results are allowed.
 */
export function convertToShares(
  state: State,
  terms: Terms,
  assets: bigint,
  rounding: Rounding = "down",
): bigint {
  const { x, y } = validateEconomics(state, terms);

  quantity(assets);

  if (!["up", "down"].includes(rounding)) throw new Error("unsupported rounding");

  return quantity(
    rounding === "up" ? ceilDiv(assets * y, x) : (assets * y) / x,
    "converted shares",
  );
}

/**
 * Convert share units to underlying-asset base units at the supplied virtualized snapshot.
 * Use floor(shares * x / y) by default, or its ceiling when rounding is "up".
 * Input and result must fit 0..Q_MAX. This is fee-free arithmetic and may return zero;
 * it does not prove sufficient vault liquidity or permission to execute.
 */
export function convertToAssets(
  state: State,
  terms: Terms,
  shares: bigint,
  rounding: Rounding = "down",
): bigint {
  const { x, y } = validateEconomics(state, terms);

  quantity(shares);

  if (!["up", "down"].includes(rounding)) throw new Error("unsupported rounding");

  return quantity(
    rounding === "up" ? ceilDiv(shares * x, y) : (shares * x) / y,
    "converted assets",
  );
}

/**
 * Quote without changing State: deposit amount is gross assets, mint amount is shares,
 * withdraw amount is net assets, and redeem amount is shares. All values are integer base units.
 * Deposit/redeem floor conversion outputs; mint/withdraw ceil required conversion inputs.
 * Fees round up using the net or gross denominator appropriate to the operation.
 * Zero mathematical results are valid here; transition separately checks eligibility and user bounds.
 */
export function preview(operation: Operation, amount: bigint, state: State, terms: Terms): Quote {
  const { x, y } = validateEconomics(state, terms);

  quantity(amount);

  let grossAssets: bigint, netAssets: bigint, shares: bigint, fee: bigint;

  // Exact-input paths floor the output; exact-output paths ceil what the user must supply.
  // Gross amounts already include fees, so their fee denominator differs from net amounts.
  switch (operation) {
    case "deposit":
      grossAssets = amount;
      fee = feeTotal(amount, terms.entryBps);
      netAssets = amount - fee;
      shares = (netAssets * y) / x;
      break;
    case "mint":
      shares = amount;
      netAssets = ceilDiv(shares * x, y);
      fee = ceilDiv(netAssets * terms.entryBps, BPS);
      grossAssets = netAssets + fee;
      break;
    case "withdraw":
      netAssets = amount;
      fee = feeRaw(amount, terms.exitBps);
      grossAssets = amount + fee;
      shares = ceilDiv(grossAssets * y, x);
      break;
    case "redeem":
      shares = amount;
      grossAssets = (shares * x) / y;
      fee = ceilDiv(grossAssets * terms.exitBps, BPS + terms.exitBps);
      netAssets = grossAssets - fee;
      break;
    default:
      throw new Error(`unsupported operation: ${operation}`);
  }

  for (const [name, result] of Object.entries({ grossAssets, netAssets, shares, fee }))
    quantity(result, name);

  return {
    operation,
    amount,
    grossAssets,
    netAssets,
    shares,
    fee,
    pricing: "exact_at_snapshot",
    execution: "unchecked",
  };
}
