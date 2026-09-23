/** Economic state transitions enforce intent bounds; ledger construction and authorization are separate. */
import type {
  ExecutionOptions,
  Operation,
  Quote,
  State,
  Terms,
  TransitionResult,
} from "../types.js";
import { positive, quantity } from "./integer.js";
import { preview, validateEconomics } from "./quotes.js";

/**
 * Check the requested entry/exit direction against capability and pause bits.
 * Immediate paths use bits 1/2 and asynchronous paths 4/8; pause bits 1/2 apply across paths.
 * The caller supplies already-validated State/Terms. This check does not authorize a signer
 * or decide whether the compiled implementation supports the advertised mode combination.
 */
export function assertEnabled(
  state: State,
  terms: Terms,
  entry: boolean,
  asynchronous = false,
): void {
  // Capability bits select the path; pause bits independently restrict its entry/exit direction.
  const mode = asynchronous ? (entry ? 4n : 8n) : entry ? 1n : 2n;

  if (!(terms.executionModes & mode)) throw new Error("execution mode disabled");

  if (state.pauseFlags & (entry ? 1n : 2n)) throw new Error("operation paused");
}

/**
 * Compare a previously validated quote with the operation-specific slippage bound.
 * Deposit/redeem require minimum shares/net assets; mint/withdraw cap gross assets/shares.
 * The same integer field therefore has different units and inequality directions by operation.
 */
function assertUserBound(operation: Operation, quote: Quote, bound: bigint): void {
  // Deposit/redeem bounds are minimum receipts; mint/withdraw bounds are maximum inputs.
  if (
    (operation === "deposit" && quote.shares < bound) ||
    (operation === "mint" && quote.grossAssets > bound) ||
    (operation === "withdraw" && quote.shares > bound) ||
    (operation === "redeem" && quote.netAssets < bound)
  )
    throw new Error("user bound violated");
}

/**
 * Validate a positive amount and bound, quote one snapshot, and return a new successor State.
 * Enforce enabled/unpaused direction, positive economic outputs, user bound and successor capacity;
 * asynchronous profile-0 execution permits only deposit/redeem.
 * Advance sequence once, accrue the underlying fee and return signed shareMint: issuance positive,
 * burn negative. Inputs are not mutated; UTxO provenance, signatures and ledger funding remain external.
 */
export function transition(
  operation: Operation,
  amount: bigint,
  bound: bigint,
  state: State,
  terms: Terms,
  { asynchronous = false }: ExecutionOptions = {},
): TransitionResult {
  if (asynchronous && !["deposit", "redeem"].includes(operation))
    throw new Error("profile 0 asynchronous requests support only deposit and redeem");

  positive(amount, "amount");
  positive(bound, "user bound");

  const quote = preview(operation, amount, state, terms);
  const entry = operation === "deposit" || operation === "mint";

  assertEnabled(state, terms, entry, asynchronous);

  for (const key of ["grossAssets", "netAssets", "shares"] as const) positive(quote[key], key);

  quantity(quote.fee, "fee");
  assertUserBound(operation, quote, bound);

  const successor = {
    ...state,
    sequence: state.sequence + 1n,
    backingAssets: state.backingAssets + (entry ? quote.netAssets : -quote.grossAssets),
    economicSupply: state.economicSupply + (entry ? quote.shares : -quote.shares),
    accruedFees: state.accruedFees + quote.fee,
  };

  validateEconomics(successor, terms);

  return { quote, successor, shareMint: entry ? quote.shares : -quote.shares };
}
