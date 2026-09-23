// Authentication and accounting invariants shared by the two State handlers.
// Config is referenced, State is consumed, and share minting must match the
// successor's supply delta. Family modules decide which economic action is valid.

use aiken/collection/list
use cardano/address.{from_script}
use cardano/assets
use cardano/transaction.{Input, OutputReference, Transaction}
use ctvs/decode
use ctvs/ledger
use ctvs/validation
use ctvs/wire.{
  CollectFees, Config, Datum, MintPurpose, NativeAsset, SetPause, State,
  StateAction, Terms, TopUpReserve, UpdateSupply,
}

/// Resolve identity-bearing inputs before trusting their datum fields. The Config
/// must be referenced at its permanent lock and match this script's seed/commitment.
pub fn authenticate(
  tx: Transaction,
  own_ref: OutputReference,
  policy: ByteArray,
  seed: OutputReference,
  commitment: ByteArray,
  lock_hash: ByteArray,
  permits_modes: fn(Int) -> Bool,
) -> (Input, Datum, Terms) {
  let own = ledger.unique_state(tx, policy)
  expect own.output_reference == own_ref
  expect [config_input] = list.filter(
    tx.reference_inputs,
    fn(i) { assets.quantity_of(i.output.value, policy, wire.id_name) != 0 },
  )
  let config = decode.config(ledger.raw_datum(config_input.output))
  expect  
      Config {
        vault_policy,
        seed: actual_seed,
        terms_hash,
        terms,
        storage_lovelace,
        ..
      }
    = config
  expect and {
      validation.valid_config(config),
      permits_modes(terms.execution_modes),
      vault_policy == policy,
      actual_seed == seed,
      terms_hash == commitment,
      config_input.output.address == from_script(lock_hash),
      config_input.output.reference_script == None,
      config_input.output.value == (
        assets.from_lovelace(storage_lovelace)
          |> assets.add(policy, wire.id_name, 1)
      ),
      list.all(
        tx.inputs,
        fn(i) { assets.quantity_of(i.output.value, policy, wire.id_name) == 0 },
      ),
      when terms.underlying is {
        NativeAsset { policy_id, .. } -> policy_id != policy
        _ -> True
      },
    }
  let old = decode.state(ledger.raw_datum(own.output))
  expect
    ledger.exact_state_output(
      own.output,
      policy,
      commitment,
      old,
      terms.underlying,
    )
  (own, old, terms)
}

/// Require the entire mint value to equal this vault's signed share delta.
/// Nonzero deltas need an UpdateSupply redeemer pointing back to the same State;
/// a zero delta requires no mint purposes at all, including unrelated policies.
pub fn supply_mint(
  tx: Transaction,
  policy: ByteArray,
  own_ref: OutputReference,
  delta: Int,
) -> Bool {
  expect tx.mint == assets.from_asset(policy, wire.share_name, delta)
  // A zero-net Batch still changes State and creates Claims, but has no mint
  // purpose. Its gross obligations are enforced by the spending handler.
  if delta == 0 {
    list.all(
      tx.redeemers,
      fn(p) {
        when p.1st is {
          transaction.Mint(_) -> False
          _ -> True
        }
      },
    )
  } else {
    let envelope = decode.mint_action_envelope(
      ledger.redeemer(tx, transaction.Mint(policy)),
    )
    expect  
        MintPurpose { magic, wire_version, action: UpdateSupply { state_ref } }
      = envelope
    and {
      magic == wire.magic,
      wire_version == wire.wire_version,
      state_ref == own_ref,
    }
  }
}

/// Carry immutable identity forward and advance sequence once, accepting only
/// the mutable accounting partitions from the action implementation. This builds
/// an expected datum; it does not validate bounds or locate an output by itself.
pub fn next_state(
  old: Datum,
  a: Int,
  s: Int,
  f: Int,
  r: Int,
  pause: Int,
) -> Datum {
  expect State { magic, wire_version, vault_policy, terms_hash, sequence, .. } = old
  State {
    magic,
    wire_version,
    vault_policy,
    terms_hash,
    sequence: sequence + 1,
    backing_assets: a,
    economic_supply: s,
    accrued_fees: f,
    storage_lovelace: r,
    pause_flags: pause,
  }
}

/// Fees leave only through their fixed destination; reserve top-ups do not buy
/// shares. Only changing pause flags requires the configured authority key.
pub fn administrative_next(
  tx: Transaction,
  old: Datum,
  terms: Terms,
  action: StateAction,
) -> Datum {
  expect  
      State {
        backing_assets: a,
        economic_supply: s,
        accrued_fees: f,
        storage_lovelace: r,
        pause_flags,
        ..
      }
    = old
  when action is {
    CollectFees { state_output, fee_output } -> {
      expect f > 0 && state_output != fee_output
      expect
        ledger.economic_payment(
          ledger.output(tx, fee_output),
          terms.fee_destination,
          terms.underlying,
          f,
        )
      next_state(old, a, s, 0, r, pause_flags)
    }
    TopUpReserve { additional_lovelace, .. } ->
      next_state(old, a, s, f, r + additional_lovelace, pause_flags)
    SetPause { pause_flags: next_flags, .. } -> {
      expect Some(key) = terms.pause_key
      expect list.has(tx.extra_signatories, key)
      next_state(old, a, s, f, r, next_flags)
    }
    _ -> fail
  }
}

/// Match the action's computed successor to one exact output and its physical value.
/// Exactly one output may carry the permanent State token, and the total mint
/// must equal the economic supply difference from the old State.
/// Bounds on the action's intermediate arithmetic belong to its family handler.
pub fn validate_successor(
  tx: Transaction,
  own_ref: OutputReference,
  policy: ByteArray,
  commitment: ByteArray,
  terms: Terms,
  old: Datum,
  expected: Datum,
  state_output: Int,
) -> Bool {
  expect State { economic_supply: old_supply, .. } = old
  expect  
      State { backing_assets: next_backing, economic_supply: next_supply, .. }
    = expected
  expect
    when terms.max_backing is {
      None -> True
      Some(cap) -> next_backing <= cap
    }
  and {
    ledger.exact_state_output(
      ledger.output(tx, state_output),
      policy,
      commitment,
      expected,
      terms.underlying,
    ),
    list.length(
      list.filter(
        tx.outputs,
        fn(o) { assets.quantity_of(o.value, policy, wire.state_name) != 0 },
      ),
    ) == 1,
    supply_mint(tx, policy, own_ref, next_supply - old_supply),
  }
}

/// Couple issuance to an authenticated consumed State and its declared successor.
/// This does not recompute the action: the State spending handler must also pass.
pub fn mint_update(
  tx: Transaction,
  state_ref: OutputReference,
  policy: ByteArray,
  seed: OutputReference,
  commitment: ByteArray,
  lock_hash: ByteArray,
  permits_modes: fn(Int) -> Bool,
  successor_index: Int,
) -> Bool {
  expect ledger.allowed_purposes(tx)
  let (_, old, terms) = authenticate(
    tx,
    state_ref,
    policy,
    seed,
    commitment,
    lock_hash,
    permits_modes,
  )
  expect State { economic_supply: before, .. } = old
  let successor_output = ledger.output(tx, successor_index)
  let successor = decode.state(ledger.raw_datum(successor_output))
  expect State { economic_supply: after, .. } = successor
  expect
    ledger.exact_state_output(
      successor_output,
      policy,
      commitment,
      successor,
      terms.underlying,
    )
  expect after != before
  supply_mint(tx, policy, state_ref, after - before)
}
