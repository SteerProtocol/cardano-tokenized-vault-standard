// CTVS-1 uses one parameterized program for State spending and share minting.
// The spend handler proves the economic transition; minting cross-checks the
// same consumed State so issuance cannot be authorized independently.

use aiken/primitive/bytearray
use cardano/address.{Script, from_script}
use cardano/assets
use cardano/transaction.{InlineDatum, OutputReference, Transaction}
use ctvs/decode
use ctvs/deployment
use ctvs/genesis
use ctvs/ledger
use ctvs/state_core
use ctvs/validation
use ctvs/wire.{Initialize, MintPurpose, StateSpend, UpdateSupply}
use ctvs1/state

/// Independent family entrypoint. Permanent identity assets select State
/// dispatch before any untrusted datum or redeemer can select a user action.
validator vault(seed: OutputReference, commitment: ByteArray) {
  spend(
    supplied: Option<Data>,
    raw_redeemer: Data,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    expect bytearray.length(deployment.config_lock_hash) == 28
    let own = ledger.input(tx, own_ref)
    expect Script(policy) = own.output.address.payment_credential
    expect
      own.output.address == from_script(policy) && own.output.reference_script == None
    expect assets.quantity_of(own.output.value, policy, wire.id_name) == 0
    expect InlineDatum(raw) = own.output.datum
    expect supplied == Some(raw)
    let state_quantity = assets.quantity_of(
      own.output.value,
      policy,
      wire.state_name,
    )
    expect state_quantity == 1
    expect StateSpend { magic, wire_version, action } = decode.state_action_envelope(
      raw_redeemer,
    )
    expect magic == wire.magic && wire_version == wire.wire_version
    state.validate(
      tx,
      own_ref,
      policy,
      seed,
      commitment,
      deployment.config_lock_hash,
      action,
    )
  }

  mint(raw_redeemer: Data, policy: ByteArray, tx: Transaction) {
    expect bytearray.length(deployment.config_lock_hash) == 28
    expect MintPurpose { magic, wire_version, action } = decode.mint_action_envelope(
      raw_redeemer,
    )
    expect magic == wire.magic && wire_version == wire.wire_version
    expect validation.valid_mint_action(action)
    when action is {
      Initialize { config_output, state_output } ->
        genesis.validate(
          tx,
          policy,
          seed,
          commitment,
          deployment.config_lock_hash,
          config_output,
          state_output,
          state.permits_modes,
        )
      UpdateSupply { state_ref } -> {
        expect StateSpend { magic, wire_version, action: state_action } = decode.state_action_envelope(
          ledger.redeemer(tx, transaction.Spend(state_ref)),
        )
        expect magic == wire.magic && wire_version == wire.wire_version
        expect state.valid_action(state_action)
        state_core.mint_update(
          tx,
          state_ref,
          policy,
          seed,
          commitment,
          deployment.config_lock_hash,
          state.permits_modes,
          state.output_index(state_action),
        )
      }
    }
  }

  else(_) {
    fail
  }
}
