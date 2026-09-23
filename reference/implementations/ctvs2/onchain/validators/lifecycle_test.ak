// Exercise actual vault dispatch with recoverable but unsupported Request
// economics. Refunds require neither current State nor Config, while the
// immutable Config lock has no recovery branch of its own.

use aiken/builtin
use aiken/collection/list
use aiken/interval.{Finite, Interval, IntervalBound}
use cardano/address.{from_script, from_verification_key}
use cardano/assets
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Spend, Transaction,
}
use config_lock
use ctvs/deployment
use ctvs/validation
use ctvs/wire.{
  Ada, AnySettler, Cancel, Config, Datum, Destination, ExpiryRefund,
  KeyController, Recovery, Request, RequestAction, RequestSpend, SetPause,
  StateSpend, Terms,
}
use vault

/// Actual validator entrypoint checks. Complete visible values are balanced;
/// signatures/collateral and full serialized ledger acceptance remain separate.
const policy = #"11111111111111111111111111111111111111111111111111111111"

const controller = #"22222222222222222222222222222222222222222222222222222222"

const token_policy = #"33333333333333333333333333333333333333333333333333333333"

const txid = #"4444444444444444444444444444444444444444444444444444444444444444"

fn ref(index: Int) -> OutputReference {
  OutputReference { transaction_id: txid, output_index: index }
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

fn request_datum(version: Int) -> Datum {
  Request {
    magic: wire.magic,
    wire_version: version,
    recovery: Recovery {
      vault_policy: policy,
      controller: KeyController { key_hash: controller },
      refund: Destination {
        address: from_verification_key(controller),
        datum: None,
      },
      deadline_posix_ms: 1_000,
    },
    // Neither unsupported constructor nor settlement byte limit may block refund.
    economic_body: builtin.constr_data(
      99,
      [builtin.b_data(builtin.replicate_byte(5_000, 0))],
    ),
  }
}

fn fixture(
  version: Int,
  action: RequestAction,
  lower: Int,
  upper: Int,
) -> (Transaction, Data, Data) {
  let raw_datum: Data = request_datum(version)
  let redeemer: Data = RequestSpend {
    magic: wire.magic,
    wire_version: 2,
    action,
  }
  let escrow = assets.from_lovelace(3_500_000)
    |> assets.add(token_policy, #"554e4954", 101_000)
    |> assets.add(token_policy, #"4558545241", 7)
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [
      Input {
        output_reference: ref(0),
        output: Output {
          address: from_script(policy),
          value: escrow,
          datum: InlineDatum(raw_datum),
          reference_script: None,
        },
      },
      Input {
        output_reference: ref(1),
        output: Output {
          address: from_verification_key(controller),
          value: assets.from_lovelace(5_000_000),
          datum: NoDatum,
          reference_script: None,
        },
      },
    ],
    outputs: [
      Output {
        address: from_verification_key(controller),
        value: escrow,
        datum: NoDatum,
        reference_script: None,
      },
      Output {
        address: from_verification_key(controller),
        value: assets.from_lovelace(4_600_000),
        datum: NoDatum,
        reference_script: None,
      },
    ],
    fee: 400_000,
    extra_signatories: [controller],
    validity_range: range(lower, upper),
    redeemers: [Pair(Spend(ref(0)), redeemer)],
  }
  (tx, raw_datum, redeemer)
}

fn balanced(tx: Transaction) -> Bool {
  let incoming = list.foldl(
    tx.inputs,
    tx.mint,
    fn(input, value) { assets.merge(input.output.value, value) },
  )
  let outgoing = list.foldl(
    tx.outputs,
    assets.from_lovelace(tx.fee),
    fn(output, value) { assets.merge(output.value, value) },
  )
  incoming == outgoing
}

test actual_vault_cancel_dispatch_recovers_unsupported_oversized_body_and_surplus() {
  let (tx, raw, action) = fixture(2, Cancel { refund_output: 0 }, 100, 200)
  balanced(tx) && vault.vault.spend(
    ref(99),
    txid,
    Some(raw),
    action,
    ref(0),
    tx,
  )
}

test actual_vault_expiry_dispatch_needs_no_controller_signature_or_current_state() {
  let (tx, raw, action) = fixture(
    2,
    ExpiryRefund { refund_output: 0 },
    1_000,
    1_100,
  )
  let permissionless = Transaction { ..tx, extra_signatories: [] }
  balanced(permissionless) && vault.vault.spend(
    ref(99),
    txid,
    Some(raw),
    action,
    ref(0),
    permissionless,
  )
}

test actual_vault_cancel_rejects_unknown_outer_version() {
  let (tx, raw, action) = fixture(3, Cancel { refund_output: 0 }, 100, 200)
  !vault.vault.spend(ref(99), txid, Some(raw), action, ref(0), tx)
}

test actual_vault_request_rejects_state_role_before_action_interpretation() fail {
  let (tx, raw, _) = fixture(2, Cancel { refund_output: 0 }, 100, 200)
  let wrong: Data = StateSpend {
    magic: wire.magic,
    wire_version: 2,
    action: SetPause { pause_flags: 0, state_output: 0 },
  }
  vault.vault.spend(ref(99), txid, Some(raw), wrong, ref(0), tx)
}

test actual_config_lock_has_no_spend_or_reserve_recovery_branch() {
  let t = Terms {
    profile: 0,
    network_domain: txid,
    underlying: Ada,
    virtual_shares: 1,
    max_backing: None,
    entry_bps: 0,
    exit_bps: 0,
    fee_destination: Destination {
      address: from_verification_key(controller),
      datum: None,
    },
    pause_key: None,
    settlers: AnySettler,
    execution_modes: 15,
    max_batch: 16,
    descriptor_hash: None,
  }
  let config = Config {
    magic: wire.magic,
    wire_version: 2,
    vault_policy: policy,
    seed: ref(99),
    terms_hash: validation.terms_hash(t),
    terms: t,
    storage_lovelace: 3_000_000,
  }
  let raw: Data = config
  let action: Data = 0
  let protected = assets.from_lovelace(3_000_000)
    |> assets.add(policy, wire.id_name, 1)
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [
      Input {
        output_reference: ref(0),
        output: Output {
          address: from_script(deployment.config_lock_hash),
          value: protected,
          datum: InlineDatum(raw),
          reference_script: None,
        },
      },
      Input {
        output_reference: ref(1),
        output: Output {
          address: from_verification_key(controller),
          value: assets.from_lovelace(5_000_000),
          datum: NoDatum,
          reference_script: None,
        },
      },
    ],
    outputs: [
      Output {
        address: from_verification_key(controller),
        value: protected,
        datum: NoDatum,
        reference_script: None,
      },
      Output {
        address: from_verification_key(controller),
        value: assets.from_lovelace(4_600_000),
        datum: NoDatum,
        reference_script: None,
      },
    ],
    fee: 400_000,
    extra_signatories: [controller],
    redeemers: [Pair(Spend(ref(0)), action)],
  }
  validation.valid_config(config) && balanced(tx) && !config_lock.config_lock.spend(
    Some(raw),
    action,
    ref(0),
    tx,
  )
}
