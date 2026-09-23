/** CTVS-1 v0.6.3 sections 6 and 7. All quantities are base-unit bigint. */
export const Q_MAX = (1n << 63n) - 1n;
export const BPS = 10_000n;

/**
 * Accept bigint only within the inclusive bounds, defaulting to 0..Q_MAX.
 * This is a guard, not a parser: JavaScript numbers and decimal strings always throw.
 * Wider intermediate arithmetic may remain bigint until its public result reaches this boundary.
 */
export function integer(value: unknown, name: string, min = 0n, max = Q_MAX): bigint {
  if (typeof value !== "bigint" || value < min || value > max)
    throw new RangeError(`${name} must be bigint in ${min}..${max}`);

  return value;
}

export const quantity = (n: unknown, name = "quantity"): bigint => integer(n, name);

export const positive = (n: unknown, name = "quantity"): bigint => integer(n, name, 1n);

/**
 * Return the least integer greater than or equal to n/d using exact bigint arithmetic.
 * The numerator must be nonnegative and the denominator positive.
 * Intermediate products are not restricted to Q_MAX; callers bound the resulting quantities.
 */
export function ceilDiv(n: bigint, d: bigint): bigint {
  if (typeof n !== "bigint" || n < 0n || typeof d !== "bigint" || d <= 0n)
    throw new RangeError("ceilDiv requires nonnegative bigint numerator and positive denominator");

  return (n + d - 1n) / d;
}

/**
 * Compute ceil(netAmount * bps / 10,000) in underlying-asset base units.
 * Used when the supplied amount excludes the fee; adding this result gives the gross amount.
 * The amount must be 0..Q_MAX and the rate 0..9,999 basis points.
 */
export function feeRaw(amount: bigint, bps: bigint): bigint {
  quantity(amount);
  integer(bps, "bps", 0n, 9999n);

  return ceilDiv(amount * bps, BPS);
}

/**
 * Compute ceil(grossAmount * bps / (10,000 + bps)) in underlying-asset base units.
 * The input already includes its fee; subtract this result to obtain the net amount.
 * This denominator differs from feeRaw and must not be substituted at an exact-input boundary.
 */
export function feeTotal(amount: bigint, bps: bigint): bigint {
  quantity(amount);
  integer(bps, "bps", 0n, 9999n);

  return ceilDiv(amount * bps, BPS + bps);
}
