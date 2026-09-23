use aiken/collection/list
use cardano/address.{from_verification_key}
use cardano/assets
use cardano/transaction.{Input, NoDatum, Output, Transaction}
use ctvs/deployment
use ctvs/ledger
use ctvs/testing.{balance, config_output, destination, envelope, key, other_key, policy, ref, snapshot, state_output, unit}
use ctvs/validation
use ctvs/wire.{Asset, CollectFees, Datum, MintPurpose, MintShares, NativeAsset, Redeem, SetPause, State, StateAction, Terms, TopUpReserve, UpdateSupply, Withdraw}
use ctvs1/state

// Review fixtures use actual source predicates and balanced visible value.
// They do not establish ledger witnesses or authenticate historical fixture supply.
fn rules() -> Terms { testing.terms(unit(), 3) }
fn check(tx: Transaction, action: StateAction, t: Terms) -> Bool {
  state.validate(tx, ref(0), policy, ref(99), validation.terms_hash(t), deployment.config_lock_hash, action)
}
fn tx_for(t: Terms, old: Datum, next: Datum, action: StateAction, payout_asset: Asset, payout: Int) -> Transaction {
  expect State { economic_supply: before, .. } = old
  expect State { economic_supply: after, .. } = next
  let mint = assets.from_asset(policy, wire.share_name, after - before)
  let m: Data = MintPurpose { magic: wire.magic, wire_version: 2, action: UpdateSupply { state_ref: ref(0) } }
  let redeemers = if before == after { [Pair(transaction.Spend(ref(0)), envelope(action))] } else {
    [Pair(transaction.Spend(ref(0)), envelope(action)), Pair(transaction.Mint(policy), m)]
  }
  balance(Transaction {
    ..transaction.placeholder,
    inputs: [
      Input { output_reference: ref(0), output: state_output(old, t) },
      Input { output_reference: ref(1), output: Output { address: from_verification_key(other_key), value: ledger.economic_value(t.underlying, 10000000, 20000000) |> assets.add(policy, wire.share_name, before), datum: NoDatum, reference_script: None } },
    ],
    reference_inputs: [Input { output_reference: ref(2), output: config_output(t) }],
    outputs: [state_output(next, t), Output { address: destination().address, value: ledger.economic_value(payout_asset, payout, 2000000), datum: NoDatum, reference_script: None }],
    mint, redeemers, fee: 400000, extra_signatories: [],
  })
}
fn fees(amount: Int) -> (Transaction, StateAction, Terms) {
  let t = Terms { ..rules(), pause_key: None }
  let old = snapshot(t, 2, 1000, 1000, 500, 3000000, 3)
  let next = snapshot(t, 3, 1000, 1000, 0, 3000000, 3)
  let action = CollectFees { state_output: 0, fee_output: 1 }
  (tx_for(t, old, next, action, unit(), amount), action, t)
}
test c1_fee_collection_is_permissionless_while_fully_paused() {
  let (tx, action, t) = fees(500)
  tx.extra_signatories == [] && check(tx, action, t)
}
test c1_fee_collection_rejects_native_underpayment() fail {
  let (tx, action, t) = fees(499)
  check(tx, action, t)
}
test c1_fee_collection_rejects_native_overpayment() fail {
  let (tx, action, t) = fees(501)
  check(tx, action, t)
}
test c1_fee_collection_rejects_zero_liability() fail {
  let t = rules()
  let old = snapshot(t, 0, 1000, 1000, 0, 3000000, 0)
  let next = snapshot(t, 1, 1000, 1000, 0, 3000000, 0)
  let a = CollectFees { state_output: 0, fee_output: 1 }
  check(tx_for(t, old, next, a, unit(), 1), a, t)
}
test c1_zero_topup_rejected() fail {
  let t = rules()
  let old = snapshot(t, 0, 1000, 1000, 0, 3000000, 0)
  let next = snapshot(t, 1, 1000, 1000, 0, 3000000, 0)
  let a = TopUpReserve { additional_lovelace: 0, state_output: 0 }
  check(tx_for(t, old, next, a, unit(), 0), a, t)
}
test c1_topup_cannot_add_backing() fail {
  let t = rules()
  let old = snapshot(t, 0, 1000, 1000, 0, 3000000, 0)
  let next = snapshot(t, 1, 1001, 1000, 0, 3000001, 0)
  let a = TopUpReserve { additional_lovelace: 1, state_output: 0 }
  check(tx_for(t, old, next, a, unit(), 0), a, t)
}
test c1_disabled_pause_key_rejects_even_when_key_named() fail {
  let t = Terms { ..rules(), pause_key: None }
  let old = snapshot(t, 0, 1000, 1000, 0, 3000000, 0)
  let next = snapshot(t, 1, 1000, 1000, 0, 3000000, 1)
  let a = SetPause { pause_flags: 1, state_output: 0 }
  let tx = tx_for(t, old, next, a, unit(), 0)
  check(Transaction { ..tx, extra_signatories: [key] }, a, t)
}
fn mint_case(pause: Int, bound: Int) -> (Transaction, StateAction, Terms) {
  let t = rules()
  let old = snapshot(t, 0, 1000, 1000, 0, 3000000, pause)
  let next = snapshot(t, 1, 1100, 1100, 1, 3000000, pause)
  let a = MintShares { receiver: destination(), target_shares: 100, max_assets: bound, state_output: 0, receiver_output: 1 }
  (tx_for(t, old, next, a, NativeAsset { policy_id: policy, asset_name: wire.share_name }, 100), a, t)
}
test c1_entry_pause_blocks_exact_share_mint() fail {
  let (tx, a, t) = mint_case(1, 101)
  check(tx, a, t)
}
test c1_exit_pause_does_not_block_exact_share_mint() {
  let (tx, a, t) = mint_case(2, 101)
  check(tx, a, t)
}
test c1_exact_share_mint_rejects_bound_one_unit_too_small() fail {
  let (tx, a, t) = mint_case(0, 100)
  check(tx, a, t)
}
fn withdraw_case(pause: Int, bound: Int) -> (Transaction, StateAction, Terms) {
  let t = rules()
  let old = snapshot(t, 0, 1000, 1000, 0, 3000000, pause)
  let next = snapshot(t, 1, 899, 899, 1, 3000000, pause)
  let a = Withdraw { receiver: destination(), net_assets: 100, max_shares: bound, state_output: 0, receiver_output: 1 }
  (tx_for(t, old, next, a, unit(), 100), a, t)
}
test c1_exit_pause_blocks_exact_asset_withdrawal() fail {
  let (tx, a, t) = withdraw_case(2, 101)
  check(tx, a, t)
}
test c1_entry_pause_does_not_block_exact_asset_withdrawal() {
  let (tx, a, t) = withdraw_case(1, 101)
  check(tx, a, t)
}
test c1_exact_asset_withdrawal_rejects_bound_one_unit_too_small() fail {
  let (tx, a, t) = withdraw_case(0, 100)
  check(tx, a, t)
}
test c1_receiver_cannot_include_unrelated_native_token() fail {
  let (tx, a, t) = withdraw_case(0, 101)
  let bad = testing.change_output(tx, 1, fn(o) { Output { ..o, value: assets.add(o.value, policy, wire.share_name, 1) } })
  check(bad, a, t)
}
test c1_receiver_cannot_attach_reference_script() fail {
  let (tx, a, t) = withdraw_case(0, 101)
  let bad = testing.change_output(tx, 1, fn(o) { Output { ..o, reference_script: Some(other_key) } })
  check(bad, a, t)
}
test c1_extra_reference_does_not_change_validated_quote() {
  let (tx, a, t) = withdraw_case(0, 101)
  let extras = list.concat(tx.reference_inputs, [Input { output_reference: ref(3), output: Output { address: from_verification_key(other_key), value: assets.from_lovelace(9999999), datum: NoDatum, reference_script: None } }])
  check(Transaction { ..tx, reference_inputs: extras }, a, t)
}
