// Explicitly evaluate both compiled handlers over one synthetic transaction.
// All expected failures force evaluation with expect, so False is not a passing
// negative-test shortcut. These tests do not simulate phase-1 or publish scripts.

use aiken/builtin
use aiken/collection/list
use cardano/address.{Script, from_script}
use cardano/assets
use cardano/transaction.{InlineDatum, Input, NoDatum, Output, Transaction}
use ctvs/ledger
use ctvs/price.{ConvertToAssets, PreviewMint, Price}
use ctvs/wire.{Ada}
use example/fixtures.{
  claim, config, context, integer_record, market_datum, provider_hash, ref,
  source, with_claim, with_source,
}
use example/lending_a.{OnChain}
use lending_a_price
use receipt_consumer

fn provider(tx: Transaction) -> Bool {
  let credential = Script(provider_hash)
  lending_a_price.lending_a_price.withdraw(
    config(),
    ledger.redeemer(tx, transaction.Withdraw(credential)),
    credential,
    tx,
  )
}

fn consumer(tx: Transaction) -> Bool {
  let c = config()
  receipt_consumer.receipt_consumer.spend(
    provider_hash,
    c.market_id,
    c.share_asset,
    c.underlying_asset,
    Some(integer_record(0)),
    integer_record(0),
    ref(0),
    tx,
  )
}

fn complete(tx: Transaction) -> Bool {
  expect provider(tx)
  expect consumer(tx)
  True
}

fn lie() -> Transaction {
  let p = claim()
  let tx = with_claim(
    context(),
    Price {
      ..p,
      assertions: [
        ConvertToAssets { shares: 50_000_000_000, assets: 700_000_000 },
      ],
    },
  )
  expect [out] = tx.outputs
  Transaction {
    ..tx,
    outputs: [Output { ..out, datum: InlineDatum(integer_record(700_000_000)) }],
  }
}

test converts_500_receipts_to_550_assets_and_records_value() {
  complete(context())
}

test consumer_reads_same_claim_but_does_not_recompute_native_price() {
  // Demonstrates why requiring the provider is essential. The consumer alone
  // can validate custody and claim use while the proposed economic result lies.
  consumer(lie())
}

test well_formed_700_asset_lie_fails_combined_validation() fail {
  expect complete(lie())
  True
}

test all_supported_assertions_are_verified() {
  let p = claim()
  complete(
    with_claim(
      context(),
      Price {
        ..p,
        assertions: [ConvertToAssets { shares: 100, assets: 1 }, ..p.assertions],
      },
    ),
  )
}

test incorrect_extra_assertion_fails_even_when_consumer_query_is_correct() fail {
  let p = claim()
  expect
    complete(
      with_claim(
        context(),
        Price {
          ..p,
          assertions: list.concat(
            p.assertions,
            [ConvertToAssets { shares: 100, assets: 2 }],
          ),
        },
      ),
    )
  True
}

test incorrect_extra_mint_preview_fails() fail {
  let p = claim()
  expect
    complete(
      with_claim(
        context(),
        Price {
          ..p,
          assertions: [
            PreviewMint { shares_out: 100, assets_in: 112 },
            ..p.assertions
          ],
        },
      ),
    )
  True
}

test evidence_pointer_without_reference_input_fails() fail {
  let tx = context()
  // Keeping only the code reference does not supply the native accounting state.
  expect [_, code] = tx.reference_inputs
  expect complete(Transaction { ..tx, reference_inputs: [code] })
  True
}

test code_reference_is_not_accounting_evidence() fail {
  let p = claim()
  let evidence: Data = OnChain { market_state_ref: ref(3) }
  expect complete(with_claim(context(), Price { ..p, evidence }))
  True
}

test fake_state_without_identity_nft_fails() fail {
  let s = source().output
  expect
    complete(
      with_source(
        context(),
        Output { ..s, value: assets.from_lovelace(2_000_000) },
      ),
    )
  True
}

test identity_at_wrong_address_fails() fail {
  let s = source().output
  expect
    complete(
      with_source(
        context(),
        Output { ..s, address: from_script(provider_hash) },
      ),
    )
  True
}

test no_inline_native_datum_fails() fail {
  let s = source().output
  expect complete(with_source(context(), Output { ..s, datum: NoDatum }))
  True
}

test native_datum_trailing_field_fails() fail {
  let s = source().output
  let malformed = builtin.constr_data(
    0,
    list.map([1100, 1000, 9], builtin.i_data),
  )
  expect
    complete(
      with_source(context(), Output { ..s, datum: InlineDatum(malformed) }),
    )
  True
}

test zero_supply_fails() fail {
  let s = source().output
  expect
    complete(
      with_source(
        context(),
        Output { ..s, datum: InlineDatum(fixtures.market_datum(1100, 0)) },
      ),
    )
  True
}

test negative_accounting_value_fails() fail {
  let s = source().output
  expect
    complete(
      with_source(
        context(),
        Output { ..s, datum: InlineDatum(fixtures.market_datum(-1, 1000)) },
      ),
    )
  True
}

test malformed_evidence_fails() fail {
  let p = claim()
  expect
    complete(with_claim(context(), Price { ..p, evidence: integer_record(2) }))
  True
}

test wrong_asset_pair_fails() fail {
  let p = claim()
  expect complete(with_claim(context(), Price { ..p, underlying_asset: Ada }))
  True
}

test code_reference_without_withdrawal_does_not_authorize_consumer() fail {
  let tx = context()
  expect consumer(Transaction { ..tx, withdrawals: [] })
  True
}

test unapproved_provider_fails_consumer() fail {
  let tx = context()
  expect
    consumer(
      Transaction { ..tx, withdrawals: [Pair(Script(fixtures.state_hash), 0)] },
    )
  True
}

test nonzero_withdrawal_fails() fail {
  let tx = context()
  expect
    complete(
      Transaction { ..tx, withdrawals: [Pair(Script(provider_hash), 1)] },
    )
  True
}

test missing_provider_redeemer_fails_consumer() fail {
  let tx = context()
  expect
    consumer(
      Transaction {
        ..tx,
        redeemers: [Pair(transaction.Spend(ref(0)), integer_record(0))],
      },
    )
  True
}

test quote_for_different_receipt_quantity_fails_consumer() fail {
  let p = claim()
  let tx = with_claim(
    context(),
    Price { ..p, assertions: [ConvertToAssets { shares: 100, assets: 1 }] },
  )
  expect provider(tx)
  expect consumer(tx)
  True
}

test receipt_diversion_fails_consumer() fail {
  let tx = context()
  expect [out] = tx.outputs
  expect
    complete(
      Transaction {
        ..tx,
        outputs: [Output { ..out, value: assets.from_lovelace(2_000_000) }],
      },
    )
  True
}

test wrong_checkpoint_value_fails_consumer() fail {
  let tx = context()
  expect [out] = tx.outputs
  expect
    complete(
      Transaction {
        ..tx,
        outputs: [Output { ..out, datum: InlineDatum(integer_record(1)) }],
      },
    )
  True
}

test two_positions_cannot_share_one_successor() fail {
  let tx = context()
  expect [input] = tx.inputs
  expect
    complete(
      Transaction {
        ..tx,
        inputs: [input, Input { ..input, output_reference: ref(9) }],
      },
    )
  True
}

// These provider-only views deliberately do not change the consumer-held quantity.
test zero_and_fractional_views_round_down() {
  let p = claim()
  provider(
    with_claim(
      context(),
      Price {
        ..p,
        assertions: [
          ConvertToAssets { shares: 0, assets: 0 },
          ConvertToAssets { shares: 99, assets: 1 },
          ConvertToAssets { shares: 90, assets: 0 },
        ],
      },
    ),
  )
}

test maximum_quantity_uses_exact_intermediate_arithmetic() {
  let maximum = 9_223_372_036_854_775_807
  let state = source()
  let changed = Input {
    ..state,
    output: Output {
      ..state.output,
      datum: InlineDatum(market_datum(maximum, maximum)),
    },
  }
  let p = claim()
  provider(
    with_claim(
      with_source(context(), changed.output),
      Price {
        ..p,
        assertions: [ConvertToAssets { shares: maximum, assets: maximum }],
      },
    ),
  )
}

test overflowing_economic_result_is_not_clamped() fail {
  let state = source()
  let changed = Input {
    ..state,
    output: Output {
      ..state.output,
      datum: InlineDatum(market_datum(9_223_372_036_854_775_807, 1)),
    },
  }
  let p = claim()
  expect
    provider(
      with_claim(
        with_source(context(), changed.output),
        Price {
          ..p,
          assertions: [
            ConvertToAssets { shares: 2, assets: 9_223_372_036_854_775_807 },
          ],
        },
      ),
    )
  True
}
