// Asynchronous State orchestration authenticates the old snapshot, delegates
// complete Request settlement, then checks one successor and its supply delta.
// Administrative actions cannot consume Requests as incidental script inputs.

use aiken/collection/list
use cardano/transaction.{OutputReference, Transaction}
use ctvs/ledger
use ctvs/state_core
use ctvs/validation
use ctvs/wire.{Batch, CollectFees, SetPause, StateAction, TopUpReserve}
use ctvs2/async

/// Only async capability bits are executable here. Mixed direct/async modes
/// require another implementation; one-sided modes do not establish a complete lifecycle.
pub fn permits_modes(modes: Int) -> Bool {
  modes == 4 || modes == 8 || modes == 12
}

/// Check only fields needed before Batch traversal or administrative dispatch.
/// Per-entry ordering, reference validity and output allocation are proved during
/// settlement, avoiding a redundant full traversal of the same Request list.
pub fn valid_action(action: StateAction) -> Bool {
  when action is {
    Batch { state_output, entries, reward_key, reward_output } ->
      validation.valid_index(state_output) && validation.bytes28(reward_key) && list.length(
        entries,
      ) >= 1 && list.length(entries) <= 16 && when reward_output is {
        None -> True
        Some(index) -> validation.valid_index(index)
      }
    CollectFees { state_output, fee_output } ->
      validation.valid_index(state_output) && validation.valid_index(fee_output) && state_output != fee_output
    TopUpReserve { additional_lovelace, state_output } ->
      validation.positive_q(additional_lovelace) && validation.valid_index(
        state_output,
      )
    SetPause { pause_flags, state_output } ->
      pause_flags >= 0 && pause_flags <= 3 && validation.valid_index(
        state_output,
      )
    _ -> False
  }
}

pub fn output_index(action: StateAction) -> Int {
  when action is {
    Batch { state_output, .. } |
    CollectFees { state_output, .. } |
    TopUpReserve { state_output, .. } |
    SetPause { state_output, .. } -> state_output
    _ -> fail
  }
}

/// Bind the old State to immutable Terms before evaluating any Request economics.
/// Batch verifies all consumed Requests and returns one aggregated successor;
/// administrative branches admit no other script spends. The common final check
/// then couples that expected State to exact custody and any net share mint.
pub fn validate(
  tx: Transaction,
  own_ref: OutputReference,
  policy: ByteArray,
  seed: OutputReference,
  commitment: ByteArray,
  lock_hash: ByteArray,
  claim_hash: ByteArray,
  action: StateAction,
) -> Bool {
  expect ledger.allowed_purposes(tx) && valid_action(action)
  let (_, old, terms) = state_core.authenticate(
    tx,
    own_ref,
    policy,
    seed,
    commitment,
    lock_hash,
    permits_modes,
  )
  let expected = when action is {
    Batch { .. } ->
      async.validate_batch(tx, own_ref, old, terms, action, claim_hash)
    _ -> {
      expect
        list.all(
          tx.inputs,
          fn(i) { i.output_reference == own_ref || ledger.key_input(i) },
        )
      state_core.administrative_next(tx, old, terms, action)
    }
  }
  state_core.validate_successor(
    tx,
    own_ref,
    policy,
    commitment,
    terms,
    old,
    expected,
    output_index(action),
  )
}
