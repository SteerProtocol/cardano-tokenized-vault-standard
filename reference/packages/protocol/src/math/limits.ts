/** Economic deposit ceilings do not establish wallet funding or transaction resource feasibility. */
import type { DepositLimit, ExecutionOptions, State, Terms } from "../types.js";
import { BPS, ceilDiv, Q_MAX } from "./integer.js";
import { preview, validateEconomics } from "./quotes.js";
import { assertEnabled } from "./transition.js";

/**
 * Return the maximum gross deposit allowed by snapshot economics in underlying base units.
 * Disabled/paused entry is unavailable; exhausted sequence or no positive issuance yields known zero.
 * Search the monotonic upper-capacity predicate first, then test issuance positivity:
 * tiny deposits that round to zero do not make the valid region a prefix.
 * Wallet funding, minimum ADA and complete transaction resources remain explicitly unknown.
 */
export function maxDeposit(
  state: State,
  terms: Terms,
  { asynchronous = false }: ExecutionOptions = {},
): DepositLimit {
  validateEconomics(state, terms);

  try {
    assertEnabled(state, terms, true, asynchronous);
  } catch (e) {
    return {
      status: "unavailable",
      reason: e instanceof Error ? e.message : String(e),
      constructionLimit: "unknown",
    };
  }

  if (state.sequence === Q_MAX)
    return {
      status: "known",
      value: 0n,
      reason: "sequence_exhausted",
      constructionLimit: "unknown",
    };

  const cap = terms.maxBacking ?? Q_MAX;
  const { x, y } = validateEconomics(state, terms);

  const upperCapacity = (d: bigint): boolean => {
    const f = ceilDiv(d * terms.entryBps, BPS + terms.entryBps),
      n = d - f,
      q = (n * y) / x;

    return (
      state.backingAssets + n <= cap &&
      state.economicSupply + q <= Q_MAX &&
      state.accruedFees + f <= Q_MAX &&
      state.backingAssets +
        state.accruedFees +
        d +
        (terms.underlying === "ada" ? state.storageLovelace : 0n) <=
        Q_MAX
    );
  };

  let lo = 0n,
    hi = Q_MAX;

  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;

    if (upperCapacity(mid)) lo = mid;
    else hi = mid - 1n;
  }

  const result = preview("deposit", lo, state, terms);

  return {
    status: "known",
    value: result.shares === 0n ? 0n : lo,
    scope: "economic_maximum",
    constructionLimit: "unknown",
  };
}
