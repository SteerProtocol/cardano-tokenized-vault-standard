// Exercise recovery independently of economic decoding, then test settlement
// against one immutable price snapshot. Zero net mint cases still owe every
// gross Claim, and traversal checks prevent omission or shared output indices.

use aiken/builtin
use aiken/collection/list
use aiken/interval.{Finite, Interval, IntervalBound}
use cardano/address.{from_script, from_verification_key}
use cardano/assets
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Spend, Transaction,
}
use ctvs/ledger
use ctvs/math
use ctvs/validation
use ctvs/wire.{
  AcknowledgeBatch, AnySettler, Batch, Cancel, Claim, Datum, DepositExactGross,
  Destination, ExpiryRefund, KeyController, KeySet, NativeAsset, Recovery,
  RedeemExactShares, Request, RequestBody, RequestKind, RequestSpend,
  SettleEntry, State, StateAction, StateSpend, Terms,
}
use ctvs2/async

const p = #"11111111111111111111111111111111111111111111111111111111"

const q = #"22222222222222222222222222222222222222222222222222222222"

const user = #"33333333333333333333333333333333333333333333333333333333"

const unit_policy = #"44444444444444444444444444444444444444444444444444444444"

const txid = #"5555555555555555555555555555555555555555555555555555555555555555"

fn ref(n: Int) -> OutputReference {
  OutputReference { transaction_id: txid, output_index: n }
}

fn destination() -> Destination {
  Destination { address: from_verification_key(user), datum: None }
}

fn underlying() -> wire.Asset {
  NativeAsset { policy_id: unit_policy, asset_name: "UNIT" }
}

fn shares() -> wire.Asset {
  NativeAsset { policy_id: p, asset_name: wire.share_name }
}

fn range(lower: Int, upper: Int) -> Interval {
  Interval {
    lower_bound: IntervalBound { bound_type: Finite(lower), is_inclusive: True },
    upper_bound: IntervalBound {
      bound_type: Finite(upper),
      is_inclusive: False,
    },
  }
}

fn recovery() -> Recovery {
  Recovery {
    vault_policy: p,
    controller: KeyController { key_hash: user },
    refund: destination(),
    deadline_posix_ms: 1000,
  }
}

fn request(body: Data) -> Datum {
  Request {
    magic: wire.magic,
    wire_version: wire.wire_version,
    recovery: recovery(),
    economic_body: body,
  }
}

fn output_at(datum: Datum, value: assets.Value, script: ByteArray) -> Output {
  let raw: Data = datum
  Output {
    address: from_script(script),
    value,
    datum: InlineDatum(raw),
    reference_script: None,
  }
}

fn recovery_fixture(body: Data) -> (Transaction, Datum) {
  let datum = request(body)
  let source = Input {
    output_reference: ref(1),
    output: output_at(
      datum,
      assets.from_lovelace(3_500_000)
        |> assets.add(unit_policy, "UNIT", 101_000)
        |> assets.add(unit_policy, "EXTRA", 7),
      p,
    ),
  }
  let refund = Output {
    ..source.output,
    address: destination().address,
    datum: NoDatum,
  }
  (
    Transaction {
      ..transaction.placeholder,
      inputs: [source],
      outputs: [refund],
      extra_signatories: [user],
      validity_range: range(100, 200),
    },
    datum,
  )
}

test cancellation_recovers_unsupported_economic_constructor_and_all_surplus() {
  let (tx, datum) = recovery_fixture(builtin.constr_data(99, []))
  async.validate_request(tx, ref(1), p, datum, Cancel { refund_output: 0 })
}

test cancellation_does_not_decode_bad_success_receiver_or_fee_budget() {
  let nonsense: Data = [0, -1, -999]
  let (tx, datum) = recovery_fixture(nonsense)
  async.validate_request(tx, ref(1), p, datum, Cancel { refund_output: 0 })
}

test cancellation_requires_controller_signatory() {
  let (tx, datum) = recovery_fixture(builtin.constr_data(99, []))
  !async.validate_request(
    Transaction { ..tx, extra_signatories: [] },
    ref(1),
    p,
    datum,
    Cancel { refund_output: 0 },
  )
}

test cancellation_preserves_unexpected_asset() {
  let (tx, datum) = recovery_fixture(builtin.constr_data(99, []))
  expect [refund] = tx.outputs
  let reduced = Output {
    ..refund,
    value: assets.add(refund.value, unit_policy, "EXTRA", -1),
  }
  !async.validate_request(
    Transaction { ..tx, outputs: [reduced] },
    ref(1),
    p,
    datum,
    Cancel { refund_output: 0 },
  )
}

test expiry_boundary_is_permissionless_at_deadline() {
  let (tx, datum) = recovery_fixture(builtin.constr_data(99, []))
  async.validate_request(
    Transaction {
      ..tx,
      extra_signatories: [],
      validity_range: range(1000, 1100),
    },
    ref(1),
    p,
    datum,
    ExpiryRefund { refund_output: 0 },
  )
}

test expiry_straddling_deadline_rejected() {
  let (tx, datum) = recovery_fixture(builtin.constr_data(99, []))
  !async.validate_request(
    Transaction { ..tx, validity_range: range(999, 1001) },
    ref(1),
    p,
    datum,
    ExpiryRefund { refund_output: 0 },
  )
}

test cancellation_cannot_consume_a_second_request() {
  let (tx, datum) = recovery_fixture(builtin.constr_data(99, []))
  expect [one] = tx.inputs
  let two = Input { ..one, output_reference: ref(2) }
  !async.validate_request(
    Transaction { ..tx, inputs: [one, two] },
    ref(1),
    p,
    datum,
    Cancel { refund_output: 0 },
  )
}

test request_shaped_state_cannot_use_recovery() {
  let (tx, datum) = recovery_fixture(builtin.constr_data(99, []))
  expect [one] = tx.inputs
  let bad = Input {
    ..one,
    output: Output {
      ..one.output,
      value: assets.add(one.output.value, p, wire.state_name, 1),
    },
  }
  !async.validate_request(
    Transaction { ..tx, inputs: [bad] },
    ref(1),
    p,
    datum,
    Cancel { refund_output: 0 },
  )
}

test expiry_infinite_interval_rejected() fail {
  let (tx, datum) = recovery_fixture(builtin.constr_data(99, []))
  async.validate_request(
    Transaction { ..tx, validity_range: transaction.placeholder.validity_range },
    ref(1),
    p,
    datum,
    ExpiryRefund { refund_output: 0 },
  )
}

test empty_interval_rejected() fail {
  async.finite_interval(range(1000, 1000)) == (1000, 1000)
}

fn terms() -> Terms {
  Terms {
    profile: 0,
    network_domain: txid,
    underlying: underlying(),
    virtual_shares: 1,
    max_backing: None,
    entry_bps: 0,
    exit_bps: 0,
    fee_destination: destination(),
    pause_key: Some(user),
    settlers: AnySettler,
    execution_modes: 12,
    max_batch: 16,
    descriptor_hash: None,
  }
}

fn body(
  kind: RequestKind,
  quantity: Int,
  t: Terms,
  settler_fee: Int,
) -> RequestBody {
  RequestBody {
    terms_hash: validation.terms_hash(t),
    kind,
    offered: quantity,
    minimum_output: 1,
    receiver: destination(),
    storage_lovelace: 2_000_000,
    execution_budget: 100_000,
    settler_fee,
  }
}

fn ack() -> Data {
  let raw: Data = RequestSpend {
    magic: wire.magic,
    wire_version: wire.wire_version,
    action: AcknowledgeBatch { state_ref: ref(0) },
  }
  raw
}

fn batch_data(action: StateAction) -> Data {
  let raw: Data = StateSpend {
    magic: wire.magic,
    wire_version: wire.wire_version,
    action,
  }
  raw
}

fn claim_output(
  index: Int,
  asset: wire.Asset,
  quantity: Int,
  carried: Int,
  t: Terms,
) -> Output {
  let datum = Claim {
    magic: wire.magic,
    wire_version: wire.wire_version,
    vault_policy: p,
    request_ref: ref(index),
    state_ref: ref(0),
    terms_hash: validation.terms_hash(t),
    asset,
    economic_quantity: quantity,
    receiver: destination(),
    carried_lovelace: carried,
  }
  output_at(datum, ledger.economic_value(asset, quantity, carried), q)
}

fn fixture(
  backing: Int,
  supply: Int,
  deposit: Int,
  redeem: Int,
  fee: Int,
  topup: Int,
) -> (Transaction, Datum, Terms, StateAction, Datum) {
  let t = terms()
  let old = State {
    magic: wire.magic,
    wire_version: wire.wire_version,
    vault_policy: p,
    terms_hash: validation.terms_hash(t),
    sequence: 7,
    backing_assets: backing,
    economic_supply: supply,
    accrued_fees: 0,
    storage_lovelace: 4_000_000,
    pause_flags: 0,
  }
  let dep = math.quote_deposit(backing, supply, t, deposit)
  let red = math.quote_redeem(backing, supply, t, redeem)
  let next = State {
    magic: wire.magic,
    wire_version: wire.wire_version,
    vault_policy: p,
    terms_hash: validation.terms_hash(t),
    sequence: 8,
    backing_assets: backing + dep.net - red.gross,
    economic_supply: supply + dep.shares - red.shares,
    accrued_fees: dep.fee + red.fee,
    storage_lovelace: 4_000_000,
    pause_flags: 0,
  }
  let action = Batch {
    state_output: 0,
    entries: [
      SettleEntry { request_ref: ref(1), claim_output: 1, claim_topup: topup },
      SettleEntry { request_ref: ref(2), claim_output: 2, claim_topup: 0 },
    ],
    reward_key: user,
    reward_output: if fee > 0 {
      Some(3)
    } else {
      None
    },
  }
  let deposit_body: Data = body(DepositExactGross, deposit, t, fee)
  let redeem_body: Data = body(RedeemExactShares, redeem, t, fee)
  let outputs = [
    output_at(next, ledger.state_value(next, underlying()), p),
    claim_output(1, shares(), dep.shares, 2_100_000 - fee + topup, t),
    claim_output(2, underlying(), red.net, 2_100_000 - fee, t),
  ]
  let outputs = if fee > 0 {
    list.concat(
      outputs,
      [
        Output {
          address: from_verification_key(user),
          value: assets.from_lovelace(fee * 2),
          datum: NoDatum,
          reference_script: None,
        },
      ],
    )
  } else {
    outputs
  }
  (
    Transaction {
      ..transaction.placeholder,
      inputs: [
        Input {
          output_reference: ref(0),
          output: output_at(old, ledger.state_value(old, underlying()), p),
        },
        Input {
          output_reference: ref(1),
          output: output_at(
            request(deposit_body),
            ledger.economic_value(underlying(), deposit, 2_100_000),
            p,
          ),
        },
        Input {
          output_reference: ref(2),
          output: output_at(
            request(redeem_body),
            ledger.economic_value(shares(), redeem, 2_100_000),
            p,
          ),
        },
      ],
      outputs,
      mint: assets.from_asset(p, wire.share_name, dep.shares - red.shares),
      validity_range: range(100, 200),
      extra_signatories: [user],
      redeemers: [
        Pair(Spend(ref(0)), batch_data(action)),
        Pair(Spend(ref(1)), ack()),
        Pair(Spend(ref(2)), ack()),
      ],
    },
    old,
    t,
    action,
    next,
  )
}

test zero_net_mint_batch_still_settles_both_gross_obligations() {
  let (tx, old, t, action, expected) = fixture(1000, 1000, 10, 10, 0, 0)
  assets.is_zero(tx.mint) && async.validate_batch(tx, ref(0), old, t, action, q) == expected
}

test mixed_batch_uses_one_old_snapshot_despite_rounding() {
  let (tx, old, t, action, expected) = fixture(10, 3, 10, 1, 0, 0)
  expect State { backing_assets, economic_supply, .. } = expected
  backing_assets == 18 && economic_supply == 5 && async.validate_batch(
    tx,
    ref(0),
    old,
    t,
    action,
    q,
  ) == expected
}

test external_claim_topup_is_carried_without_buying_shares() {
  let (tx, old, t, action, expected) = fixture(
    1000,
    1000,
    10,
    10,
    100_000,
    500_000,
  )
  async.validate_batch(tx, ref(0), old, t, action, q) == expected
}

test batch_requires_settler_explicit_signature_even_for_zero_reward() fail {
  let (tx, old, t, action, _) = fixture(1000, 1000, 10, 10, 0, 0)
  async.validate_batch(
    Transaction { ..tx, extra_signatories: [] },
    ref(0),
    old,
    t,
    action,
    q,
  ) == old
}

test batch_rejects_missing_gross_claim_when_net_mint_is_zero() fail {
  let (tx, old, t, action, _) = fixture(1000, 1000, 10, 10, 0, 0)
  expect [state, dep, red] = tx.outputs
  let unfunded = Output { ..dep, value: assets.from_lovelace(2_100_000) }
  async.validate_batch(
    Transaction { ..tx, outputs: [state, unfunded, red] },
    ref(0),
    old,
    t,
    action,
    q,
  ) == old
}

test batch_rejects_cancellation_as_acknowledgment() fail {
  let (tx, old, t, action, _) = fixture(1000, 1000, 10, 10, 0, 0)
  let cancel: Data = RequestSpend {
    magic: wire.magic,
    wire_version: wire.wire_version,
    action: Cancel { refund_output: 1 },
  }
  async.validate_batch(
    Transaction {
      ..tx,
      redeemers: [
        Pair(Spend(ref(0)), batch_data(action)),
        Pair(Spend(ref(1)), cancel),
        Pair(Spend(ref(2)), ack()),
      ],
    },
    ref(0),
    old,
    t,
    action,
    q,
  ) == old
}

test batch_rejects_omitted_consumed_request() fail {
  let (tx, old, t, _, _) = fixture(1000, 1000, 10, 10, 0, 0)
  let action = Batch {
    state_output: 0,
    entries: [
      SettleEntry { request_ref: ref(1), claim_output: 1, claim_topup: 0 },
    ],
    reward_key: user,
    reward_output: None,
  }
  async.validate_batch(tx, ref(0), old, t, action, q) == old
}

test batch_rejects_shared_claim_index() fail {
  let (tx, old, t, _, _) = fixture(1000, 1000, 10, 10, 0, 0)
  let action = Batch {
    state_output: 0,
    entries: [
      SettleEntry { request_ref: ref(1), claim_output: 1, claim_topup: 0 },
      SettleEntry { request_ref: ref(2), claim_output: 1, claim_topup: 0 },
    ],
    reward_key: user,
    reward_output: None,
  }
  async.validate_batch(tx, ref(0), old, t, action, q) == old
}

test batch_rejects_deadline_straddling_interval() fail {
  let (tx, old, t, action, _) = fixture(1000, 1000, 10, 10, 0, 0)
  async.validate_batch(
    Transaction { ..tx, validity_range: range(999, 1001) },
    ref(0),
    old,
    t,
    action,
    q,
  ) == old
}

test settlement_upper_bound_at_deadline_is_valid() {
  let (tx, old, t, action, expected) = fixture(1000, 1000, 10, 10, 0, 0)
  async.validate_batch(
    Transaction { ..tx, validity_range: range(999, 1000) },
    ref(0),
    old,
    t,
    action,
    q,
  ) == expected
}

test gross_redemptions_cannot_exceed_old_supply_even_if_deposits_offset() fail {
  let (tx, old, t, action, _) = fixture(10, 3, 10, 4, 0, 0)
  async.validate_batch(tx, ref(0), old, t, action, q) == old
}

test request_acknowledgment_requires_real_consumed_state() fail {
  let (tx, _, _, _, _) = fixture(1000, 1000, 10, 10, 0, 0)
  expect [state, deposit, redeem] = tx.inputs
  let datum = ledger.datum(deposit.output)
  async.validate_request(
    Transaction { ..tx, inputs: [deposit, redeem], reference_inputs: [state] },
    ref(1),
    p,
    datum,
    AcknowledgeBatch { state_ref: ref(0) },
  )
}

test request_acknowledgment_matches_actual_batch_branch() {
  let (tx, _, _, _, _) = fixture(1000, 1000, 10, 10, 0, 0)
  let datum = ledger.datum(ledger.input(tx, ref(1)).output)
  async.validate_request(
    tx,
    ref(1),
    p,
    datum,
    AcknowledgeBatch { state_ref: ref(0) },
  )
}

test settler_keyset_is_enforced() fail {
  let (tx, old, t, action, _) = fixture(1000, 1000, 10, 10, 0, 0)
  async.validate_batch(
    tx,
    ref(0),
    old,
    Terms { ..t, settlers: KeySet { keys: [q] } },
    action,
    q,
  ) == old
}

test claim_topup_aggregate_must_fit_quantity_bound() fail {
  let (tx, old, t, action, _) = fixture(1000, 1000, 10, 10, 0, wire.max_q)
  async.validate_batch(tx, ref(0), old, t, action, q) == old
}

test unsupported_economics_are_rejected_by_batch_single_decode() fail {
  let (tx, old, t, action, _) = fixture(1000, 1000, 10, 10, 0, 0)
  expect [state, deposit, redeem] = tx.inputs
  let invalid: Data = request(builtin.constr_data(99, []))
  let deposit = Input {
    ..deposit,
    output: Output { ..deposit.output, datum: InlineDatum(invalid) },
  }
  async.validate_batch(
    Transaction { ..tx, inputs: [state, deposit, redeem] },
    ref(0),
    old,
    t,
    action,
    q,
  ) == old
}

fn traversal_action(
  entries: List<SettleEntry>,
  reward_output: Option<Int>,
) -> StateAction {
  Batch { state_output: 0, entries, reward_key: user, reward_output }
}

test batch_traversal_rejects_duplicate_request_with_distinct_claims() fail {
  let (tx, old, t, _, _) = fixture(1000, 1000, 10, 10, 0, 0)
  let entries = [
    SettleEntry { request_ref: ref(1), claim_output: 1, claim_topup: 0 },
    SettleEntry { request_ref: ref(1), claim_output: 2, claim_topup: 0 },
  ]
  expect _ = async.validate_batch(
    tx,
    ref(0),
    old,
    t,
    traversal_action(entries, None),
    q,
  )
  True
}

test batch_traversal_rejects_reverse_request_order() fail {
  let (tx, old, t, _, _) = fixture(1000, 1000, 10, 10, 0, 0)
  let entries = [
    SettleEntry { request_ref: ref(2), claim_output: 2, claim_topup: 0 },
    SettleEntry { request_ref: ref(1), claim_output: 1, claim_topup: 0 },
  ]
  expect _ = async.validate_batch(
    tx,
    ref(0),
    old,
    t,
    traversal_action(entries, None),
    q,
  )
  True
}

test batch_traversal_rejects_state_substituted_for_request_at_equal_count() fail {
  let (tx, old, t, _, _) = fixture(1000, 1000, 10, 10, 0, 0)
  let entries = [
    SettleEntry { request_ref: ref(0), claim_output: 1, claim_topup: 0 },
    SettleEntry { request_ref: ref(2), claim_output: 2, claim_topup: 0 },
  ]
  expect _ = async.validate_batch(
    tx,
    ref(0),
    old,
    t,
    traversal_action(entries, None),
    q,
  )
  True
}

test batch_traversal_rejects_claim_and_state_output_collision() fail {
  let (tx, old, t, _, _) = fixture(1000, 1000, 10, 10, 0, 0)
  let entries = [
    SettleEntry { request_ref: ref(1), claim_output: 0, claim_topup: 0 },
    SettleEntry { request_ref: ref(2), claim_output: 2, claim_topup: 0 },
  ]
  expect _ = async.validate_batch(
    tx,
    ref(0),
    old,
    t,
    traversal_action(entries, None),
    q,
  )
  True
}

test batch_traversal_rejects_reward_and_state_output_collision() fail {
  let (tx, old, t, action, _) = fixture(1000, 1000, 10, 10, 100, 0)
  expect Batch { entries, .. } = action
  expect _ = async.validate_batch(
    tx,
    ref(0),
    old,
    t,
    traversal_action(entries, Some(0)),
    q,
  )
  True
}
