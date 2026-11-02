// Hypothetical LendingA adapter. Its native datum is deliberately separate from
// Price. The NFT's uniqueness and correct accounting transitions are assumed
// external protocol guarantees, not proved by this read-only adapter.

use aiken/builtin
use aiken/collection/list
use cardano/address.{Address, Script}
use cardano/assets
use cardano/transaction.{InlineDatum, OutputReference, Transaction}
use ctvs/price.{
  ConvertToAssets, ConvertToShares, PreviewDeposit, PreviewMint, PreviewRedeem,
  PreviewWithdraw, Price, PriceAssertion,
}
use ctvs/validation
use ctvs/wire.{Asset, NativeAsset}

pub type Config {
  Config {
    market_id: Asset,
    share_asset: Asset,
    underlying_asset: Asset,
    state_address: Address,
  }
}

/// Provider-specific evidence contains a pointer, not a script or copied NAV.
pub type Evidence {
  OnChain { market_state_ref: OutputReference }
}

/// Assumed authoritative native accounting, already net of applicable liabilities.
/// This example has no time-dependent accrual, entry/exit fees or signed reports.
pub type MarketState {
  MarketState { accounted_assets: Int, receipt_supply: Int }
}

/// Exact records reject trailing fields rather than silently accepting extensions.
pub fn record(raw: Data, count: Int) -> List<Data> {
  let Pair(tag, fields) = builtin.un_constr_data(raw)
  expect tag == 0 && list.length(fields) == count
  fields
}

pub fn decode_evidence(raw: Data) -> OutputReference {
  expect [ref] = record(raw, 1)
  expect [id, index] = record(ref, 2)
  expect transaction_id: ByteArray = id
  expect output_index: Int = index
  let ref = OutputReference { transaction_id, output_index }
  expect validation.valid_out_ref(ref)
  ref
}

pub fn matches_subject(claim: Price, config: Config) -> Bool {
  claim.market_id == config.market_id && claim.share_asset == config.share_asset && claim.underlying_asset == config.underlying_asset
}

/// The builder must actually include the pointed-to ledger output as evidence.
/// A plausible datum, matching address alone, or reference to provider code is
/// insufficient. Source identity depends on the configured unique market NFT.
pub fn read_market(
  config: Config,
  evidence: Data,
  tx: Transaction,
) -> MarketState {
  let state_ref = decode_evidence(evidence)
  expect [source] = list.filter(
    tx.reference_inputs,
    fn(input) { input.output_reference == state_ref },
  )
  expect Script(_) = config.state_address.payment_credential
  expect source.output.address == config.state_address
  expect NativeAsset { policy_id, asset_name } = config.market_id
  expect assets.quantity_of(source.output.value, policy_id, asset_name) == 1
  expect InlineDatum(raw) = source.output.datum
  expect [backing, supply] = record(raw, 2)
  expect accounted_assets: Int = backing
  expect receipt_supply: Int = supply
  expect validation.q(accounted_assets) && validation.positive_q(receipt_supply)
  MarketState { accounted_assets, receipt_supply }
}

/// Exact-output costs round up. Intermediates are unbounded integers; the common
/// decoder bounds claims, so an out-of-range economic result cannot be clamped.
fn ceil_div(n: Int, d: Int) -> Int {
  expect n >= 0 && d > 0
  ( n + d - 1 ) / d
}

/// No-fee snapshot arithmetic, independent of display decimals. Zero backing
/// values existing shares at zero but cannot price asset-to-share conversions,
/// deposits, mints or withdrawals. Zero supply is rejected by read_market;
/// bootstrap, virtual shares and execution/liquidity rules are not supplied here.
fn verify_assertion(assertion: PriceAssertion, market: MarketState) -> Bool {
  let backing = market.accounted_assets
  let supply = market.receipt_supply
  when assertion is {
    ConvertToAssets { shares, assets } -> assets == shares * backing / supply
    ConvertToShares { assets, shares } -> {
      expect backing > 0
      shares == assets * supply / backing
    }
    PreviewDeposit { assets_in, shares_out } -> {
      expect backing > 0
      shares_out == assets_in * supply / backing
    }
    PreviewMint { shares_out, assets_in } -> {
      expect backing > 0
      assets_in == ceil_div(shares_out * backing, supply)
    }
    PreviewWithdraw { assets_out, shares_in } -> {
      expect backing > 0
      shares_in == ceil_div(assets_out * supply, backing)
    }
    PreviewRedeem { shares_in, assets_out } ->
      assets_out == shares_in * backing / supply
  }
}

/// Every conversion and preview is checked against the same authenticated state.
/// Requires a Price already accepted by price.decode at the provider entrypoint.
pub fn verify(claim: Price, config: Config, tx: Transaction) -> Bool {
  expect matches_subject(claim, config)
  let market = read_market(config, claim.evidence, tx)
  list.all(
    claim.assertions,
    fn(assertion) { verify_assertion(assertion, market) },
  )
}
