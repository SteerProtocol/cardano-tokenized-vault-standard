// Synchronous handler tests use balanced synthetic contexts for ADA and native
// backing. Negative cases mutate one obligation at a time; signed construction
// and final transaction evaluation are covered by the TypeScript integrations.

use aiken/collection/list
use aiken/fuzz
use cardano/address.{from_script, from_verification_key}
use cardano/assets
use cardano/transaction.{InlineDatum, Input, NoDatum, Output, Transaction}
use ctvs/deployment
use ctvs/genesis
use ctvs/ledger
use ctvs/math
use ctvs/testing.{
  balance, change_output, config_output, destination, envelope, key, other_key,
  policy, ref, snapshot, state_output, unit, unit_policy,
}
use ctvs/validation
use ctvs/wire.{
  Ada, Asset, Batch, Cancel, CollectFees, Datum, Deposit, KeyController,
  MintPurpose, MintShares, NativeAsset, Recovery, Redeem, Request, RequestSpend,
  SetPause, SettleEntry, State, StateAction, Terms, TopUpReserve, UpdateSupply,
  Withdraw,
}
use ctvs1/state
use vault

fn terms(asset: Asset) -> Terms {
  testing.terms(asset, 3)
}

fn genesis_case() -> (Transaction, Terms) {
  testing.genesis_case(terms(unit()))
}

fn assert_state(tx: Transaction, action: StateAction, t: Terms) -> Bool {
  expect
    state.validate(
      tx,
      ref(0),
      policy,
      ref(99),
      validation.terms_hash(t),
      deployment.config_lock_hash,
      action,
    )
  True
}

fn assert_genesis(tx: Transaction, t: Terms) -> Bool {
  expect
    genesis.validate(
      tx,
      policy,
      ref(99),
      validation.terms_hash(t),
      deployment.config_lock_hash,
      0,
      1,
      state.permits_modes,
    )
  True
}

fn direct(
  t: Terms,
  old: Datum,
  next: Datum,
  action: StateAction,
  payout_asset: Asset,
  payout: Int,
) -> Transaction {
  expect State { economic_supply: s0, .. } = old
  expect State { economic_supply: s1, .. } = next
  let mint = assets.from_asset(policy, wire.share_name, s1 - s0)
  let mint_redeemer: Data = MintPurpose {
    magic: wire.magic,
    wire_version: 2,
    action: UpdateSupply { state_ref: ref(0) },
  }
  let redeemers = if s1 == s0 {
    [Pair(transaction.Spend(ref(0)), envelope(action))]
  } else {
    [
      Pair(transaction.Spend(ref(0)), envelope(action)),
      Pair(transaction.Mint(policy), mint_redeemer),
    ]
  }
  let funding = ledger.economic_value(t.underlying, 10000000, 20000000)
    |> assets.add(policy, wire.share_name, s0)
  balance(
    Transaction {
      ..transaction.placeholder,
      inputs: [
        Input { output_reference: ref(0), output: state_output(old, t) },
        Input {
          output_reference: ref(1),
          output: Output {
            address: from_verification_key(key),
            value: funding,
            datum: NoDatum,
            reference_script: None,
          },
        },
      ],
      reference_inputs: [
        Input { output_reference: ref(2), output: config_output(t) },
      ],
      outputs: [
        state_output(next, t),
        Output {
          address: destination().address,
          value: ledger.economic_value(payout_asset, payout, 2000000),
          datum: NoDatum,
          reference_script: None,
        },
      ],
      mint,
      redeemers,
      fee: 400000,
      extra_signatories: [key],
    },
  )
}

fn deposit_case() -> (Transaction, StateAction, Terms) {
  let t = terms(unit())
  let old = snapshot(t, 7, 1000000, 1000000, 0, 3000000, 0)
  let next = snapshot(t, 8, 1100000, 1100000, 1000, 3000000, 0)
  let action = Deposit {
    receiver: destination(),
    gross_assets: 101000,
    min_shares: 99900,
    state_output: 0,
    receiver_output: 1,
  }
  (
    direct(
      t,
      old,
      next,
      action,
      NativeAsset { policy_id: policy, asset_name: wire.share_name },
      100000,
    ),
    action,
    t,
  )
}

test whitepaper_native_deposit_and_real_spend_handler() {
  let (tx, action, t) = deposit_case()
  let own = ledger.input(tx, ref(0))
  expect InlineDatum(d) = own.output.datum
  assert_state(tx, action, t) && vault.vault.spend(
    ref(99),
    validation.terms_hash(t),
    Some(d),
    envelope(action),
    ref(0),
    tx,
  )
}

test whitepaper_deposit_real_mint_handler() {
  let (tx, _, t) = deposit_case()
  vault.vault.mint(
    ref(99),
    validation.terms_hash(t),
    ledger.redeemer(tx, transaction.Mint(policy)),
    policy,
    tx,
  )
}

test whitepaper_redeem_and_fee_collection() {
  let t = terms(unit())
  let old = snapshot(t, 8, 1100000, 1100000, 1000, 3000000, 0)
  let next = snapshot(t, 9, 1049500, 1049500, 1500, 3000000, 0)
  let action = Redeem {
    receiver: destination(),
    shares: 50500,
    min_assets: 49900,
    state_output: 0,
    receiver_output: 1,
  }
  let redeem = direct(t, old, next, action, unit(), 50000)
  let collected = snapshot(t, 10, 1049500, 1049500, 0, 3000000, 0)
  let collect = CollectFees { state_output: 0, fee_output: 1 }
  let tx = direct(t, next, collected, collect, unit(), 1500)
  assert_state(redeem, action, t) && assert_state(tx, collect, t)
}

test whitepaper_ada_deposit_separates_reserves() {
  let t = terms(Ada)
  let old = snapshot(t, 0, 100000000, 100000000, 0, 3000000, 0)
  let next = snapshot(t, 1, 110000000, 110000000, 100000, 3000000, 0)
  let action = Deposit {
    receiver: destination(),
    gross_assets: 10100000,
    min_shares: 10000000,
    state_output: 0,
    receiver_output: 1,
  }
  assert_state(
    direct(
      t,
      old,
      next,
      action,
      NativeAsset { policy_id: policy, asset_name: wire.share_name },
      10000000,
    ),
    action,
    t,
  )
}

test exact_mint_and_withdraw_apply_rounding() {
  let t = terms(unit())
  let old = snapshot(t, 0, 1000000, 1000000, 0, 3000000, 0)
  let next = snapshot(t, 1, 1100000, 1100000, 1000, 3000000, 0)
  let mint = MintShares {
    receiver: destination(),
    target_shares: 100000,
    max_assets: 101000,
    state_output: 0,
    receiver_output: 1,
  }
  let tx = direct(
    t,
    old,
    next,
    mint,
    NativeAsset { policy_id: policy, asset_name: wire.share_name },
    100000,
  )
  let final = snapshot(t, 2, 1049500, 1049500, 1500, 3000000, 0)
  let withdraw = Withdraw {
    receiver: destination(),
    net_assets: 50000,
    max_shares: 50500,
    state_output: 0,
    receiver_output: 1,
  }
  assert_state(tx, mint, t) && assert_state(
    direct(t, next, final, withdraw, unit(), 50000),
    withdraw,
    t,
  )
}

test residual_backing_remains_after_full_redemption() {
  let t = Terms {
    ..terms(unit()),
    virtual_shares: 2,
    entry_bps: 0,
    exit_bps: 0,
  }
  let old = snapshot(t, 0, 2, 3, 0, 3000000, 0)
  let next = snapshot(t, 1, 1, 0, 0, 3000000, 0)
  let action = Redeem {
    receiver: destination(),
    shares: 3,
    min_assets: 1,
    state_output: 0,
    receiver_output: 1,
  }
  assert_state(direct(t, old, next, action, unit(), 1), action, t)
}

test pause_and_topup_preserve_economics() {
  let t = terms(unit())
  let old = snapshot(t, 0, 100, 100, 0, 3000000, 0)
  let next = snapshot(t, 1, 100, 100, 0, 3000000, 3)
  let action = SetPause { pause_flags: 3, state_output: 0 }
  let tx = direct(t, old, next, action, unit(), 0)
  let topped = snapshot(t, 2, 100, 100, 0, 4000000, 3)
  let topup = TopUpReserve { additional_lovelace: 1000000, state_output: 0 }
  assert_state(tx, action, t) && assert_state(
    direct(t, next, topped, topup, unit(), 0),
    topup,
    t,
  )
}

test rejects_wrong_receiver() fail {
  let (tx, a, t) = deposit_case()
  assert_state(
    change_output(
      tx,
      1,
      fn(o) { Output { ..o, address: from_verification_key(other_key) } },
    ),
    a,
    t,
  )
}

test rejects_receiver_datum_hash_or_inline_mismatch() fail {
  let (tx, a, t) = deposit_case()
  let bad: Data = 42
  assert_state(
    change_output(tx, 1, fn(o) { Output { ..o, datum: InlineDatum(bad) } }),
    a,
    t,
  )
}

test rejects_underpaid_shares() fail {
  let (tx, a, t) = deposit_case()
  assert_state(
    change_output(
      tx,
      1,
      fn(o) {
        Output { ..o, value: assets.add(o.value, policy, wire.share_name, -1) }
      },
    ),
    a,
    t,
  )
}

test rejects_wrong_state_value() fail {
  let (tx, a, t) = deposit_case()
  assert_state(
    change_output(
      tx,
      0,
      fn(o) {
        Output { ..o, value: assets.add(o.value, unit_policy, #"554e4954", 1) }
      },
    ),
    a,
    t,
  )
}

test rejects_reserve_drain() fail {
  let (tx, a, t) = deposit_case()
  assert_state(
    change_output(
      tx,
      0,
      fn(o) { Output { ..o, value: assets.add(o.value, #"", #"", -1) } },
    ),
    a,
    t,
  )
}

test rejects_wrong_sequence() fail {
  let (tx, a, t) = deposit_case()
  let d: Data = snapshot(t, 7, 1100000, 1100000, 1000, 3000000, 0)
  assert_state(
    change_output(tx, 0, fn(o) { Output { ..o, datum: InlineDatum(d) } }),
    a,
    t,
  )
}

test rejects_reused_state_payment_index() fail {
  let (tx, _, t) = deposit_case()
  let a = Deposit {
    receiver: destination(),
    gross_assets: 101000,
    min_shares: 99900,
    state_output: 0,
    receiver_output: 0,
  }
  assert_state(tx, a, t)
}

test rejects_minimum_above_quote() fail {
  let (tx, _, t) = deposit_case()
  assert_state(
    tx,
    Deposit {
      receiver: destination(),
      gross_assets: 101000,
      min_shares: 100001,
      state_output: 0,
      receiver_output: 1,
    },
    t,
  )
}

test rejects_zero_economic_output() fail {
  let t = Terms { ..terms(unit()), virtual_shares: 1, entry_bps: 9999 }
  let old = snapshot(t, 0, 0, 0, 0, 3000000, 0)
  let next = snapshot(t, 1, 0, 0, 1, 3000000, 0)
  let a = Deposit {
    receiver: destination(),
    gross_assets: 1,
    min_shares: 1,
    state_output: 0,
    receiver_output: 1,
  }
  assert_state(
    direct(
      t,
      old,
      next,
      a,
      NativeAsset { policy_id: policy, asset_name: wire.share_name },
      0,
    ),
    a,
    t,
  )
}

test rejects_unrelated_mint() fail {
  let (tx, a, t) = deposit_case()
  assert_state(
    Transaction { ..tx, mint: assets.add(tx.mint, unit_policy, #"58", 1) },
    a,
    t,
  )
}

test rejects_wrong_mint_quantity() fail {
  let (tx, a, t) = deposit_case()
  assert_state(
    Transaction { ..tx, mint: assets.add(tx.mint, policy, wire.share_name, 1) },
    a,
    t,
  )
}

test rejects_wrong_mint_state_reference() fail {
  let (tx, a, t) = deposit_case()
  let r: Data = MintPurpose {
    magic: wire.magic,
    wire_version: 2,
    action: UpdateSupply { state_ref: ref(5) },
  }
  assert_state(
    Transaction {
      ..tx,
      redeemers: [
        Pair(transaction.Spend(ref(0)), envelope(a)),
        Pair(transaction.Mint(policy), r),
      ],
    },
    a,
    t,
  )
}

test rejects_foreign_script_input() fail {
  let (tx, a, t) = deposit_case()
  let inputs = list.map(
    tx.inputs,
    fn(i) {
      if i.output_reference == ref(1) {
        Input {
          ..i,
          output: Output { ..i.output, address: from_script(other_key) },
        }
      } else {
        i
      }
    },
  )
  assert_state(Transaction { ..tx, inputs }, a, t)
}

test rejects_zero_withdrawal_hook() fail {
  let (tx, a, t) = deposit_case()
  assert_state(
    Transaction {
      ..tx,
      withdrawals: [Pair(from_script(other_key).payment_credential, 0)],
    },
    a,
    t,
  )
}

test rejects_treasury_fields() fail {
  let (tx, a, t) = deposit_case()
  assert_state(Transaction { ..tx, current_treasury_amount: Some(0) }, a, t)
}

test rejects_config_at_wrong_lock() fail {
  let (tx, a, t) = deposit_case()
  let config = config_output(t)
  assert_state(
    Transaction {
      ..tx,
      reference_inputs: [
        Input {
          output_reference: ref(2),
          output: Output { ..config, address: from_script(other_key) },
        },
      ],
    },
    a,
    t,
  )
}

test rejects_config_without_identity() fail {
  let (tx, a, t) = deposit_case()
  let config = config_output(t)
  assert_state(
    Transaction {
      ..tx,
      reference_inputs: [
        Input {
          output_reference: ref(2),
          output: Output { ..config, value: assets.from_lovelace(3000000) },
        },
      ],
    },
    a,
    t,
  )
}

test rejects_config_with_modified_terms() fail {
  let (tx, a, t) = deposit_case()
  let other = Terms { ..t, entry_bps: 0 }
  assert_state(
    Transaction {
      ..tx,
      reference_inputs: [
        Input { output_reference: ref(2), output: config_output(other) },
      ],
    },
    a,
    t,
  )
}

test rejects_reference_script_on_state() fail {
  let (tx, a, t) = deposit_case()
  assert_state(
    change_output(
      tx,
      0,
      fn(o) { Output { ..o, reference_script: Some(other_key) } },
    ),
    a,
    t,
  )
}

test rejects_unauthorized_pause() fail {
  let t = terms(unit())
  let old = snapshot(t, 0, 100, 100, 0, 3000000, 0)
  let next = snapshot(t, 1, 100, 100, 0, 3000000, 3)
  let a = SetPause { pause_flags: 3, state_output: 0 }
  let tx = direct(t, old, next, a, unit(), 0)
  assert_state(Transaction { ..tx, extra_signatories: [] }, a, t)
}

test state_identity_cannot_take_request_refund_handler() fail {
  let (tx, _, t) = deposit_case()
  let d: Data = Request {
    magic: wire.magic,
    wire_version: 2,
    recovery: Recovery {
      vault_policy: policy,
      controller: KeyController { key_hash: key },
      refund: destination(),
      deadline_posix_ms: 1000,
    },
    economic_body: 42,
  }
  let source = ledger.input(tx, ref(0))
  let inputs = [
    Input {
      ..source,
      output: Output { ..source.output, datum: InlineDatum(d) },
    },
  ]
  let r: Data = RequestSpend {
    magic: wire.magic,
    wire_version: 2,
    action: Cancel { refund_output: 1 },
  }
  vault.vault.spend(
    ref(99),
    validation.terms_hash(t),
    Some(d),
    r,
    ref(0),
    Transaction { ..tx, inputs },
  )
}

test genesis_mints_only_permanent_identities() {
  let (tx, t) = genesis_case()
  assert_genesis(tx, t) && vault.vault.mint(
    ref(99),
    validation.terms_hash(t),
    ledger.redeemer(tx, transaction.Mint(policy)),
    policy,
    tx,
  )
}

test genesis_requires_seed() fail {
  let (tx, t) = genesis_case()
  assert_genesis(Transaction { ..tx, inputs: [] }, t)
}

test genesis_rejects_initial_share_issuance() fail {
  let (tx, t) = genesis_case()
  assert_genesis(
    Transaction { ..tx, mint: assets.add(tx.mint, policy, wire.share_name, 1) },
    t,
  )
}

test genesis_rejects_nonzero_backing() fail {
  let (tx, t) = genesis_case()
  assert_genesis(
    change_output(
      tx,
      1,
      fn(_) { state_output(snapshot(t, 0, 1, 0, 0, 3000000, 0), t) },
    ),
    t,
  )
}

test genesis_rejects_wrong_state_address() fail {
  let (tx, t) = genesis_case()
  assert_genesis(
    change_output(
      tx,
      1,
      fn(o) { Output { ..o, address: from_script(other_key) } },
    ),
    t,
  )
}

test genesis_rejects_reference_script() fail {
  let (tx, t) = genesis_case()
  assert_genesis(
    change_output(
      tx,
      0,
      fn(o) { Output { ..o, reference_script: Some(other_key) } },
    ),
    t,
  )
}

test integer_preview_rounding_fixture() {
  let t = Terms {
    ..terms(unit()),
    entry_bps: 0,
    exit_bps: 0,
    virtual_shares: 2,
  }
  math.quote_mint(0, 0, t, 3).gross == 2 && math.quote_redeem(2, 3, t, 3).net == 1
}

// Also run against the direct-only compiled family. Its genesis must bind
// advertised mode bits to the actual code retained by specialization.
test capability_variant_accepts_supported_genesis() {
  let (tx, t) = genesis_case()
  assert_genesis(tx, t)
}

test capability_variant_rejects_unsupported_terms() fail {
  let (tx, base) = genesis_case()
  let t = Terms { ..base, execution_modes: 12 }
  let updated = Transaction {
    ..tx,
    outputs: [
      config_output(t),
      state_output(snapshot(t, 0, 0, 0, 0, 3000000, 0), t),
    ],
  }
  assert_genesis(updated, t)
}

test ctvs1_genesis_rejects_every_asynchronous_mode(
  mode via fuzz.int_between(4, 15),
) fail {
  let (tx, base) = genesis_case()
  let t = Terms { ..base, execution_modes: mode }
  let tx = Transaction {
    ..tx,
    outputs: [
      config_output(t),
      state_output(snapshot(t, 0, 0, 0, 0, 3000000, 0), t),
    ],
  }
  vault.vault.mint(
    ref(99),
    validation.terms_hash(t),
    ledger.redeemer(tx, transaction.Mint(policy)),
    policy,
    tx,
  )
}

test ctvs1_state_handler_rejects_batch_action() fail {
  let (tx, _, t) = deposit_case()
  let action = Batch {
    state_output: 0,
    entries: [
      SettleEntry { request_ref: ref(1), claim_output: 1, claim_topup: 0 },
    ],
    reward_key: key,
    reward_output: None,
  }
  let own = ledger.input(tx, ref(0))
  expect InlineDatum(raw) = own.output.datum
  vault.vault.spend(
    ref(99),
    validation.terms_hash(t),
    Some(raw),
    envelope(action),
    ref(0),
    tx,
  )
}
