// Exercise native decoding and all six economic branches through the withdrawal
// entrypoint. These are snapshot quotes, not asset transfers or share issuance.

use aiken/collection/list
use aiken/fuzz
use cardano/address.{Script}
use cardano/transaction.{InlineDatum, Output}
use ctvs/price.{
  ConvertToAssets, ConvertToShares, PreviewDeposit, PreviewMint, PreviewRedeem,
  PreviewWithdraw, Price, PriceAssertion,
}
use example/fixtures
use lending_a_price

fn verify(backing: Int, supply: Int, assertions: List<PriceAssertion>) -> Bool {
  let claim = Price { ..fixtures.claim(), assertions }
  let raw: Data = claim
  let source = fixtures.source().output
  let tx = fixtures.with_source(
    fixtures.with_claim(fixtures.context(), claim),
    Output {
      ..source,
      datum: InlineDatum(fixtures.market_datum(backing, supply)),
    },
  )
  lending_a_price.lending_a_price.withdraw(
    fixtures.config(),
    raw,
    Script(fixtures.provider_hash),
    tx,
  )
}

test all_six_methods_accept_exact_division() {
  verify(
    1100,
    1000,
    [
      ConvertToAssets { shares: 100, assets: 110 },
      ConvertToShares { assets: 110, shares: 100 },
      PreviewDeposit { assets_in: 110, shares_out: 100 },
      PreviewMint { shares_out: 100, assets_in: 110 },
      PreviewWithdraw { assets_out: 110, shares_in: 100 },
      PreviewRedeem { shares_in: 100, assets_out: 110 },
    ],
  )
}

test fractional_results_round_outputs_down_and_required_inputs_up() {
  verify(
    7,
    3,
    [
      ConvertToAssets { shares: 2, assets: 4 },
      ConvertToShares { assets: 5, shares: 2 },
      PreviewDeposit { assets_in: 5, shares_out: 2 },
      PreviewMint { shares_out: 2, assets_in: 5 },
      PreviewWithdraw { assets_out: 5, shares_in: 3 },
      PreviewRedeem { shares_in: 2, assets_out: 4 },
    ],
  )
}

test mixed_decimal_base_units_need_no_metadata_normalization() {
  verify(
    1_100_000_000_000,
    100_000_000_000_000,
    [
      ConvertToAssets { shares: 100, assets: 1 },
      ConvertToShares { assets: 1, shares: 90 },
      PreviewDeposit { assets_in: 1, shares_out: 90 },
      PreviewMint { shares_out: 100, assets_in: 2 },
      PreviewWithdraw { assets_out: 1, shares_in: 91 },
      PreviewRedeem { shares_in: 100, assets_out: 1 },
    ],
  )
}

test zero_queries_are_valid_for_a_positive_market() {
  verify(
    7,
    3,
    [
      ConvertToAssets { shares: 0, assets: 0 },
      ConvertToShares { assets: 0, shares: 0 },
      PreviewDeposit { assets_in: 0, shares_out: 0 },
      PreviewMint { shares_out: 0, assets_in: 0 },
      PreviewWithdraw { assets_out: 0, shares_in: 0 },
      PreviewRedeem { shares_in: 0, assets_out: 0 },
    ],
  )
}

test all_methods_use_exact_maximum_quantity_intermediates() {
  let maximum = 9_223_372_036_854_775_807
  verify(
    maximum,
    maximum,
    [
      ConvertToAssets { shares: maximum, assets: maximum },
      ConvertToShares { assets: maximum, shares: maximum },
      PreviewDeposit { assets_in: maximum, shares_out: maximum },
      PreviewMint { shares_out: maximum, assets_in: maximum },
      PreviewWithdraw { assets_out: maximum, shares_in: maximum },
      PreviewRedeem { shares_in: maximum, assets_out: maximum },
    ],
  )
}

test zero_backing_values_existing_shares_at_zero() {
  verify(
    0,
    3,
    [
      ConvertToAssets { shares: 2, assets: 0 },
      PreviewRedeem { shares_in: 2, assets_out: 0 },
    ],
  )
}

// Even zero input must not invent a ratio or a free mint in a deficit market.
test zero_backing_rejects_convert_to_shares() fail {
  expect verify(0, 3, [ConvertToShares { assets: 0, shares: 0 }])
  True
}

test zero_backing_rejects_deposit() fail {
  expect verify(0, 3, [PreviewDeposit { assets_in: 0, shares_out: 0 }])
  True
}

test zero_backing_rejects_free_mint() fail {
  expect verify(0, 3, [PreviewMint { shares_out: 2, assets_in: 0 }])
  True
}

test zero_backing_rejects_withdrawal() fail {
  expect verify(0, 3, [PreviewWithdraw { assets_out: 0, shares_in: 0 }])
  True
}

test mint_underpayment_fails() fail {
  expect verify(7, 3, [PreviewMint { shares_out: 2, assets_in: 4 }])
  True
}

test mint_overpayment_is_not_an_exact_preview() fail {
  expect verify(7, 3, [PreviewMint { shares_out: 2, assets_in: 6 }])
  True
}

test withdrawal_underburn_fails() fail {
  expect verify(7, 3, [PreviewWithdraw { assets_out: 5, shares_in: 2 }])
  True
}

test withdrawal_overburn_is_not_an_exact_preview() fail {
  expect verify(7, 3, [PreviewWithdraw { assets_out: 5, shares_in: 4 }])
  True
}

test inverse_result_overflow_is_not_clamped() fail {
  expect
    verify(
      1,
      9_223_372_036_854_775_807,
      [ConvertToShares { assets: 2, shares: 9_223_372_036_854_775_807 }],
    )
  True
}

type Scenario {
  Scenario { backing: Int, supply: Int, amount: Int }
}

fn scenario() -> Fuzzer<Scenario> {
  let backing <- fuzz.and_then(fuzz.int_between(1, 1_000_000))
  let supply <- fuzz.and_then(fuzz.int_between(1, 1_000_000))
  let amount <- fuzz.map(fuzz.int_between(1, 1_000_000))
  Scenario { backing, supply, amount }
}

// Independent quotient/remainder oracle rather than the provider's ceil formula.
fn round_up(n: Int, d: Int) -> Int {
  n / d + if n % d == 0 {
    0
  } else {
    1
  }
}

test generated_ratios_verify_every_method(s via scenario()) {
  let down_assets = s.amount * s.backing / s.supply
  let down_shares = s.amount * s.supply / s.backing
  let up_assets = round_up(s.amount * s.backing, s.supply)
  let up_shares = round_up(s.amount * s.supply, s.backing)
  and {
    down_assets * s.supply <= s.amount * s.backing,
    s.amount * s.backing < ( down_assets + 1 ) * s.supply,
    ( up_shares - 1 ) * s.backing < s.amount * s.supply,
    s.amount * s.supply <= up_shares * s.backing,
    verify(
      s.backing,
      s.supply,
      [
        ConvertToAssets { shares: s.amount, assets: down_assets },
        ConvertToShares { assets: s.amount, shares: down_shares },
        PreviewDeposit { assets_in: s.amount, shares_out: down_shares },
        PreviewMint { shares_out: s.amount, assets_in: up_assets },
        PreviewWithdraw { assets_out: s.amount, shares_in: up_shares },
        PreviewRedeem { shares_in: s.amount, assets_out: down_assets },
      ],
    ),
  }
}

test every_method_rejects_a_one_unit_false_result(s via scenario()) {
  let down_assets = s.amount * s.backing / s.supply
  let down_shares = s.amount * s.supply / s.backing
  let up_assets = round_up(s.amount * s.backing, s.supply)
  let up_shares = round_up(s.amount * s.supply, s.backing)
  let false_assertions = [
    ConvertToAssets { shares: s.amount, assets: down_assets + 1 },
    ConvertToShares { assets: s.amount, shares: down_shares + 1 },
    PreviewDeposit { assets_in: s.amount, shares_out: down_shares + 1 },
    PreviewMint { shares_out: s.amount, assets_in: up_assets - 1 },
    PreviewWithdraw { assets_out: s.amount, shares_in: up_shares - 1 },
    PreviewRedeem { shares_in: s.amount, assets_out: down_assets + 1 },
  ]
  list.all(
    false_assertions,
    fn(assertion) { !verify(s.backing, s.supply, [assertion]) },
  )
}
