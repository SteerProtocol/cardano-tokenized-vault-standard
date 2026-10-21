/** Exact Price shapes and bounds; no provider/native evidence or economic verification. */
import { constr, constructorIndex, isConstr, validateBoundedData } from "../data/index.js";
import { quantity } from "../math/integer.js";
import type { DataConstr, PlutusData } from "../types.js";
import { assetData, assetFromData, fields } from "../wire/primitives.js";
import type { Price, PriceAssertion } from "./types.js";

export const PRICE_VERSION = 1n;
export const PRICE_MAX_ASSERTIONS = 16;

/** Fixed constructor/input/result order mirrors ctvs/price.ak. */
function parts(assertion: PriceAssertion): readonly [number, bigint, bigint] {
  switch (assertion.kind) {
    case "ConvertToAssets":
      return [0, assertion.shares, assertion.assets];
    case "ConvertToShares":
      return [1, assertion.assets, assertion.shares];
    case "PreviewDeposit":
      return [2, assertion.assetsIn, assertion.sharesOut];
    case "PreviewMint":
      return [3, assertion.sharesOut, assertion.assetsIn];
    case "PreviewWithdraw":
      return [4, assertion.assetsOut, assertion.sharesIn];
    case "PreviewRedeem":
      return [5, assertion.sharesIn, assertion.assetsOut];
    default:
      throw new TypeError("unsupported Price assertion");
  }
}

/** Query identity excludes its result; differing answers for one query remain duplicates. */
export function priceQueryKey(assertion: PriceAssertion): readonly [number, bigint] {
  const [tag, input] = parts(assertion);

  return [tag, quantity(input, "Price fixed input")];
}

function assertionData(assertion: PriceAssertion): DataConstr {
  const [tag, input, result] = parts(assertion);

  return constr(tag, [quantity(input, "Price input"), quantity(result, "Price result")]);
}

function assertionFromData(raw: PlutusData): PriceAssertion {
  if (!isConstr(raw)) throw new TypeError("Price assertion must be constructor Data");

  const tag = constructorIndex(raw.constr);
  const [first, second] = fields(raw, tag, 2, "Price assertion");
  const input = quantity(first, "Price input"),
    result = quantity(second, "Price result");

  switch (tag) {
    case 0n:
      return { kind: "ConvertToAssets", shares: input, assets: result };
    case 1n:
      return { kind: "ConvertToShares", assets: input, shares: result };
    case 2n:
      return { kind: "PreviewDeposit", assetsIn: input, sharesOut: result };
    case 3n:
      return { kind: "PreviewMint", sharesOut: input, assetsIn: result };
    case 4n:
      return { kind: "PreviewWithdraw", assetsOut: input, sharesIn: result };
    case 5n:
      return { kind: "PreviewRedeem", sharesIn: input, assetsOut: result };
    default:
      throw new TypeError("unknown Price operation");
  }
}

function checkAssertions(assertions: PriceAssertion[]): void {
  if (
    !Array.isArray(assertions) ||
    assertions.length < 1 ||
    assertions.length > PRICE_MAX_ASSERTIONS
  )
    throw new RangeError("Price assertion count must be 1..16");

  const seen = new Set<string>();

  for (const assertion of assertions) {
    const [tag, input] = priceQueryKey(assertion);
    const key = `${tag}:${input}`;

    if (seen.has(key)) throw new Error("duplicate Price query");

    seen.add(key);
  }
}

/** Validate and encode semantic Data. Original signed CBOR must never be replaced by this output. */
export function priceToData(price: Price): DataConstr {
  if (price.version !== PRICE_VERSION) throw new Error("unsupported Price version");

  checkAssertions(price.assertions);

  return constr(0, [
    price.version,
    assetData(price.marketId),
    assetData(price.shareAsset),
    assetData(price.underlyingAsset),
    price.assertions.map(assertionData),
    validateBoundedData(price.evidence),
  ]);
}

/** Decode exact constructor arity and validate every assertion, including unselected queries. */
export function priceFromData(raw: PlutusData): Price {
  const [version, market, share, underlying, assertions, evidence] = fields(raw, 0, 6, "Price");

  if (version !== PRICE_VERSION) throw new Error("unsupported Price version");

  if (!Array.isArray(assertions) || assertions.length > PRICE_MAX_ASSERTIONS)
    throw new TypeError("Price assertions must be a bounded list");

  const price: Price = {
    version,
    marketId: assetFromData(market),
    shareAsset: assetFromData(share),
    underlyingAsset: assetFromData(underlying),
    assertions: assertions.map(assertionFromData),
    evidence: validateBoundedData(evidence),
  };

  checkAssertions(price.assertions);

  return price;
}
