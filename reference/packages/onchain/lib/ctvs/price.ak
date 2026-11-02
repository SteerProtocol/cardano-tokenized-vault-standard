// Candidate provider interface, separate from WIRE-2 direct-custody actions.
// Decoding establishes a well-formed claim, never its economic truth, source
// authenticity, provider approval, liquidity or authority to move assets.

use aiken/builtin
use aiken/collection/list
use ctvs/validation
use ctvs/wire.{Ada, Asset, NativeAsset}

pub const version = 1

// Structural limit only; complete transaction resource feasibility is separate.
pub const max_assertions = 16

/// Constructor order and input-first field order are candidate wire commitments.
/// Conversions exclude action fees; previews include the declared action fees.
/// All quantities are ledger base units. Results round down except PreviewMint
/// and PreviewWithdraw, whose required input quantities round up.
pub type PriceAssertion {
  ConvertToAssets { shares: Int, assets: Int }
  ConvertToShares { assets: Int, shares: Int }
  PreviewDeposit { assets_in: Int, shares_out: Int }
  PreviewMint { shares_out: Int, assets_in: Int }
  PreviewWithdraw { assets_out: Int, shares_in: Int }
  PreviewRedeem { shares_in: Int, assets_out: Int }
}

/// One market and asset pair per invocation. Evidence is provider-specific Data
/// with an explicit common resource bound. Providers must authenticate it and
/// verify every assertion against one coherent accounting basis. Signatures,
/// when needed, live inside that provider's evidence schema.
pub type Price {
  Price {
    version: Int,
    market_id: Asset,
    share_asset: Asset,
    underlying_asset: Asset,
    assertions: List<PriceAssertion>,
    evidence: Data,
  }
}

/// A query is identified by operation and its fixed input, excluding the result.
/// Distinct results for the same query are conflicting duplicates, not choices.
pub fn query_key(assertion: PriceAssertion) -> Pair<Int, Int> {
  when assertion is {
    ConvertToAssets { shares, .. } -> Pair(0, shares)
    ConvertToShares { assets, .. } -> Pair(1, assets)
    PreviewDeposit { assets_in, .. } -> Pair(2, assets_in)
    PreviewMint { shares_out, .. } -> Pair(3, shares_out)
    PreviewWithdraw { assets_out, .. } -> Pair(4, assets_out)
    PreviewRedeem { shares_in, .. } -> Pair(5, shares_in)
  }
}

fn quantities(assertion: PriceAssertion) -> Pair<Int, Int> {
  when assertion is {
    ConvertToAssets { shares, assets } -> Pair(shares, assets)
    ConvertToShares { assets, shares } -> Pair(assets, shares)
    PreviewDeposit { assets_in, shares_out } -> Pair(assets_in, shares_out)
    PreviewMint { shares_out, assets_in } -> Pair(shares_out, assets_in)
    PreviewWithdraw { assets_out, shares_in } -> Pair(assets_out, shares_in)
    PreviewRedeem { shares_in, assets_out } -> Pair(shares_in, assets_out)
  }
}

fn valid_assertions(
  assertions: List<PriceAssertion>,
  seen: List<Pair<Int, Int>>,
  remaining: Int,
) -> Bool {
  when assertions is {
    [] -> True
    [assertion, ..rest] -> {
      let Pair(input, result) = quantities(assertion)
      let key = query_key(assertion)
      remaining > 0 && validation.q(input) && validation.q(result) && !list.has(
        seen,
        key,
      ) && valid_assertions(rest, [key, ..seen], remaining - 1)
    }
  }
}

/// Shape and common resource checks only. Calling this cannot establish that a
/// provider supports a method or that any claimed result is correct.
pub fn valid_shape(price: Price) -> Bool {
  and {
    price.version == version,
    validation.valid_asset(price.market_id),
    validation.valid_asset(price.share_asset),
    validation.valid_asset(price.underlying_asset),
    price.assertions != [],
    valid_assertions(price.assertions, [], max_assertions),
    validation.valid_bounded_data(price.evidence),
  }
}

fn asset(raw: Data) -> Asset {
  let Pair(tag, fields) = builtin.un_constr_data(raw)
  when tag is {
    0 -> {
      expect [] = fields
      Ada
    }
    1 -> {
      expect [policy, name] = fields
      expect policy_id: ByteArray = policy
      expect asset_name: ByteArray = name
      NativeAsset { policy_id, asset_name }
    }
    _ -> fail
  }
}

fn assertion(raw: Data) -> PriceAssertion {
  let Pair(tag, fields) = builtin.un_constr_data(raw)
  expect [first, second] = fields
  expect input: Int = first
  expect result: Int = second
  when tag is {
    0 -> ConvertToAssets { shares: input, assets: result }
    1 -> ConvertToShares { assets: input, shares: result }
    2 -> PreviewDeposit { assets_in: input, shares_out: result }
    3 -> PreviewMint { shares_out: input, assets_in: result }
    4 -> PreviewWithdraw { assets_out: input, shares_in: result }
    5 -> PreviewRedeem { shares_in: input, assets_out: result }
    _ -> fail
  }
}

/// Decode exact constructors and arities before typed access. Unknown versions,
/// operations, trailing fields, duplicate queries and oversized evidence fail.
/// Economic verification must follow this decoder in a real provider validator.
pub fn decode(raw: Data) -> Price {
  let Pair(tag, fields) = builtin.un_constr_data(raw)
  expect tag == 0
  expect [v, market, share, underlying, claims, evidence] = fields
  expect decoded_version: Int = v
  let raw_assertions = builtin.un_list_data(claims)
  expect list.length(raw_assertions) <= max_assertions
  let price = Price {
    version: decoded_version,
    market_id: asset(market),
    share_asset: asset(share),
    underlying_asset: asset(underlying),
    assertions: list.map(raw_assertions, assertion),
    evidence,
  }
  expect valid_shape(price)
  price
}
