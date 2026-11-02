/** Named views reuse existing formulas; capability and pause decisions never alter their arithmetic. */
import {
  convertToAssets,
  convertToShares,
  maxDeposit,
  NAMES,
  type Operation,
  preview,
  type Quote,
  type State,
  type Terms,
  transition,
} from "@ctvs/protocol";
import type { EconomicMethod, EconomicView } from "./query/types.js";
import type { Observation } from "./types.js";

const unknown = (reason: string): Observation<never> => ({ status: "unknown", reason });

const known = <T>(value: T): Observation<T> => ({ status: "known", value });

const feeUnits = (terms: Terms): EconomicView["feeUnits"] => ({
  protocol: terms.underlying,
  network: "lovelace",
  settler: "lovelace",
  executionCharge: "lovelace",
  storage: "lovelace",
  topups: "lovelace",
});

const constructionCosts = () => ({
  executionCharge: unknown("construction-specific execution charge"),
  storage: unknown("construction-specific storage/carry"),
  topups: unknown("complete minimum-ADA calculation required"),
});

const operations: Partial<Record<EconomicMethod, Operation>> = {
  previewDeposit: "deposit",
  previewMint: "mint",
  previewWithdraw: "withdraw",
  previewRedeem: "redeem",
};

function entryMode(operation: Operation, asynchronous: boolean) {
  const entry = operation === "deposit" || operation === "mint";

  return { mode: asynchronous ? (entry ? 4n : 8n) : entry ? 1n : 2n, pause: entry ? 1n : 2n };
}

function availability(
  quote: Quote,
  state: State,
  terms: Terms,
  asynchronous: boolean,
): EconomicView["availability"] {
  const { operation, amount } = quote;

  if (asynchronous && (operation === "mint" || operation === "withdraw"))
    return { status: "unsupported", code: "ASYNC_EXECUTION_UNSUPPORTED" };

  const { mode, pause } = entryMode(operation, asynchronous);

  if (!(terms.executionModes & mode)) return { status: "unavailable", code: "MODE_DISABLED" };

  if (state.pauseFlags & pause) return { status: "unavailable", code: "PAUSED" };

  if (amount === 0n) return { status: "unavailable", code: "ZERO_INPUT" };

  if (quote.grossAssets === 0n || quote.netAssets === 0n || quote.shares === 0n)
    return { status: "unavailable", code: "ZERO_OUTPUT" };

  try {
    const bound =
      operation === "mint" ? quote.grossAssets : operation === "withdraw" ? quote.shares : 1n;

    transition(operation, amount, bound, state, terms, { asynchronous });

    return { status: "available", code: "AVAILABLE" };
  } catch {
    return { status: "unavailable", code: "ECONOMIC_LIMIT" };
  }
}

function economicMaximum(
  operation: Operation,
  state: State,
  terms: Terms,
  asynchronous: boolean,
): Observation<bigint> {
  if (operation !== "deposit") return unknown("no operation-specific maximum solver exposed");

  const limit = maxDeposit(state, terms, { asynchronous });

  return limit.status === "known" ? known(limit.value) : unknown(limit.reason);
}

function resultQuantity(quote: Quote): bigint {
  if (quote.operation === "mint") return quote.grossAssets;

  if (quote.operation === "redeem") return quote.netAssets;

  return quote.shares;
}

function conversion(
  method: EconomicMethod,
  amount: bigint,
  state: State,
  terms: Terms,
): EconomicView {
  const toAssets = method === "convertToAssets";

  return {
    method,
    amount,
    inputUnit: toAssets ? "shares" : "assets",
    outputUnit: toAssets ? "assets" : "shares",
    units: { assets: terms.underlying, shares: `${state.vaultPolicy}.${NAMES.share}` },
    feeUnits: feeUnits(terms),
    result: known(
      toAssets ? convertToAssets(state, terms, amount) : convertToShares(state, terms, amount),
    ),
    quote: null,
    pricing: "fee_free_at_snapshot",
    availability: { status: "not_applicable", code: "VALUATION_ONLY" },
    capabilities: { read: true, construction: false, execution: "not_applicable" },
    economicMaximum: unknown("valuation has no operation maximum"),
    constructionMaximum: unknown("complete transaction evaluation required"),
    protocolFeeDestination: terms.feeDestination,
    fees: {
      ...constructionCosts(),
      protocol: { status: "not_applicable", reason: "fee-free valuation" },
      network: unknown("not constructed"),
      settler: { status: "not_applicable", reason: "valuation" },
    },
  };
}

export function economicView(
  method: EconomicMethod,
  amount: bigint,
  state: State,
  terms: Terms,
  asynchronous: boolean,
): EconomicView {
  const operation = operations[method];

  if (!operation) return conversion(method, amount, state, terms);

  const quote = preview(operation, amount, state, terms);
  const supported = !asynchronous || operation === "deposit" || operation === "redeem";
  const assetsInput = operation === "deposit" || operation === "withdraw";

  return {
    method,
    amount,
    inputUnit: assetsInput ? "assets" : "shares",
    outputUnit: assetsInput ? "shares" : "assets",
    units: { assets: terms.underlying, shares: `${state.vaultPolicy}.${NAMES.share}` },
    feeUnits: feeUnits(terms),
    result: known(resultQuantity(quote)),
    quote,
    pricing: asynchronous ? "indicative_until_settlement" : "exact_at_snapshot",
    availability: availability(quote, state, terms, asynchronous),
    capabilities: {
      read: true,
      construction: supported,
      execution: !supported ? "unsupported" : asynchronous ? "request" : "direct",
    },
    economicMaximum: economicMaximum(operation, state, terms, asynchronous),
    constructionMaximum: unknown("complete transaction evaluation required"),
    protocolFeeDestination: terms.feeDestination,
    fees: {
      ...constructionCosts(),
      protocol: known(quote.fee),
      network: unknown("not constructed"),
      settler: asynchronous
        ? unknown("Request-specific fee")
        : { status: "not_applicable", reason: "direct operation" },
    },
  };
}
