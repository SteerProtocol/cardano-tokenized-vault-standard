// Family handler checks bind real State and Request branches in synthetic
// contexts, including zero-net settlement. Fuzzed rejection cases ensure the
// async family cannot admit direct actions or direct/mixed execution modes.

use aiken/collection/list
use aiken/fuzz
use aiken/interval.{Finite, Interval, IntervalBound}
use cardano/address.{from_script, from_verification_key}
use cardano/assets
use cardano/transaction.{InlineDatum, Input, NoDatum, Output, Transaction}
use ctvs/deployment
use ctvs/genesis
use ctvs/ledger
use ctvs/testing.{
  balance, change_output, config_output, destination, envelope, key, policy, ref,
  snapshot, state_output, unit,
}
use ctvs/validation
use ctvs/wire.{
  AcknowledgeBatch, Asset, Batch, Claim, Datum, Deposit, DepositExactGross,
  KeyController, MintShares, NativeAsset, Recovery, Redeem, RedeemExactShares,
  Request, RequestBody, RequestKind, RequestSpend, SettleEntry, StateAction,
  Terms, Withdraw,
}
use ctvs2/state
use vault

fn terms(asset: Asset) -> Terms {
  testing.terms(asset, 12)
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
      deployment.claim_hash,
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

fn batch_request(kind: RequestKind) -> Datum {
  let t = Terms { ..terms(unit()), entry_bps: 0, exit_bps: 0 }
  let body: Data = RequestBody {
    terms_hash: validation.terms_hash(t),
    kind,
    offered: 100,
    minimum_output: 100,
    receiver: destination(),
    storage_lovelace: 2000000,
    execution_budget: 0,
    settler_fee: 0,
  }
  Request {
    magic: wire.magic,
    wire_version: 2,
    recovery: Recovery {
      vault_policy: policy,
      controller: KeyController { key_hash: key },
      refund: destination(),
      deadline_posix_ms: 1000,
    },
    economic_body: body,
  }
}

fn zero_net_batch() -> (Transaction, Terms, StateAction) {
  let t = Terms { ..terms(unit()), entry_bps: 0, exit_bps: 0 }
  let old = snapshot(t, 7, 1000, 1000, 0, 3000000, 0)
  let next = snapshot(t, 8, 1000, 1000, 0, 3000000, 0)
  let share = NativeAsset { policy_id: policy, asset_name: wire.share_name }
  let deposit_request: Data = batch_request(DepositExactGross)
  let redeem_request: Data = batch_request(RedeemExactShares)
  let entries = [
    SettleEntry { request_ref: ref(3), claim_output: 1, claim_topup: 0 },
    SettleEntry { request_ref: ref(4), claim_output: 2, claim_topup: 0 },
  ]
  let action = Batch {
    state_output: 0,
    entries,
    reward_key: key,
    reward_output: None,
  }
  let ack: Data = RequestSpend {
    magic: wire.magic,
    wire_version: 2,
    action: AcknowledgeBatch { state_ref: ref(0) },
  }
  let claims = list.map(
    [Pair(ref(3), share), Pair(ref(4), unit())],
    fn(pair) {
      let datum: Data = Claim {
        magic: wire.magic,
        wire_version: 2,
        vault_policy: policy,
        request_ref: pair.1st,
        state_ref: ref(0),
        terms_hash: validation.terms_hash(t),
        asset: pair.2nd,
        economic_quantity: 100,
        receiver: destination(),
        carried_lovelace: 2000000,
      }
      Output {
        address: from_script(deployment.claim_hash),
        datum: InlineDatum(datum),
        value: ledger.economic_value(pair.2nd, 100, 2000000),
        reference_script: None,
      }
    },
  )
  let tx = balance(
    Transaction {
      ..transaction.placeholder,
      inputs: [
        Input { output_reference: ref(0), output: state_output(old, t) },
        Input {
          output_reference: ref(1),
          output: Output {
            address: from_verification_key(key),
            datum: NoDatum,
            value: assets.from_lovelace(10000000),
            reference_script: None,
          },
        },
        Input {
          output_reference: ref(3),
          output: Output {
            address: from_script(policy),
            datum: InlineDatum(deposit_request),
            value: ledger.economic_value(unit(), 100, 2000000),
            reference_script: None,
          },
        },
        Input {
          output_reference: ref(4),
          output: Output {
            address: from_script(policy),
            datum: InlineDatum(redeem_request),
            value: ledger.economic_value(share, 100, 2000000),
            reference_script: None,
          },
        },
      ],
      outputs: [state_output(next, t), ..claims],
      reference_inputs: [
        Input { output_reference: ref(2), output: config_output(t) },
      ],
      extra_signatories: [key],
      fee: 400000,
      validity_range: Interval {
        lower_bound: IntervalBound { bound_type: Finite(0), is_inclusive: True },
        upper_bound: IntervalBound {
          bound_type: Finite(1000),
          is_inclusive: False,
        },
      },
      redeemers: [
        Pair(transaction.Spend(ref(0)), envelope(action)),
        Pair(transaction.Spend(ref(3)), ack),
        Pair(transaction.Spend(ref(4)), ack),
      ],
    },
  )
  (tx, t, action)
}

// One balanced context runs every mandatory spending handler. No minting
// purpose exists, so this demonstrates that gross obligations are not delegated
// to a policy that the ledger would omit for net zero mint.
test zero_net_batch_runs_state_and_both_request_handlers() {
  let (tx, t, _) = zero_net_batch()
  list.all(
    [ref(0), ref(3), ref(4)],
    fn(own_ref) {
      let own = ledger.input(tx, own_ref)
      expect InlineDatum(datum) = own.output.datum
      vault.vault.spend(
        ref(99),
        validation.terms_hash(t),
        Some(datum),
        ledger.redeemer(tx, transaction.Spend(own_ref)),
        own_ref,
        tx,
      )
    },
  )
}

test zero_net_batch_rejects_missing_gross_claim() fail {
  let (tx, t, action) = zero_net_batch()
  let bad = change_output(
    tx,
    1,
    fn(o) {
      Output { ..o, value: assets.add(o.value, policy, wire.share_name, -1) }
    },
  )
  assert_state(bad, action, t)
}

test ctvs2_genesis_and_real_mint_handler_accept_async_terms() {
  let (tx, t) = genesis_case()
  assert_genesis(tx, t) && vault.vault.mint(
    ref(99),
    validation.terms_hash(t),
    ledger.redeemer(tx, transaction.Mint(policy)),
    policy,
    tx,
  )
}

fn unsupported_modes() -> Fuzzer<Int> {
  fuzz.map(
    fuzz.int_between(0, 11),
    fn(index) { 4 * ( index / 3 ) + index % 3 + 1 },
  )
}

test ctvs2_genesis_rejects_direct_and_mixed_modes(
  mode via unsupported_modes(),
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

fn unsupported_direct_action(tag: Int) -> StateAction {
  when tag is {
    0 ->
      Deposit {
        receiver: destination(),
        gross_assets: 1,
        min_shares: 1,
        state_output: 0,
        receiver_output: 1,
      }
    1 ->
      MintShares {
        receiver: destination(),
        target_shares: 1,
        max_assets: 1,
        state_output: 0,
        receiver_output: 1,
      }
    2 ->
      Withdraw {
        receiver: destination(),
        net_assets: 1,
        max_shares: 1,
        state_output: 0,
        receiver_output: 1,
      }
    _ ->
      Redeem {
        receiver: destination(),
        shares: 1,
        min_assets: 1,
        state_output: 0,
        receiver_output: 1,
      }
  }
}

test ctvs2_state_handler_rejects_all_direct_action_tags(
  tag via fuzz.int_between(0, 3),
) fail {
  let (tx, t, _) = zero_net_batch()
  let own = ledger.input(tx, ref(0))
  expect InlineDatum(raw) = own.output.datum
  vault.vault.spend(
    ref(99),
    validation.terms_hash(t),
    Some(raw),
    envelope(unsupported_direct_action(tag)),
    ref(0),
    tx,
  )
}
