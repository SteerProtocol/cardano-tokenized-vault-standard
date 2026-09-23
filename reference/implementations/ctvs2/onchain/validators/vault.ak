// CTVS-2 shares a vault address between State and Request UTxOs. The permanent
// State token determines dispatch before untrusted data can select recovery;
// the mint handler couples issuance to the consumed State's Batch transition.

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
use ctvs/wire.{Initialize, MintPurpose, RequestSpend, StateSpend, UpdateSupply}
use ctvs2/async
use ctvs2/family_decode
use ctvs2/state

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
    expect bytearray.length(deployment.claim_hash) == 28
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
    if state_quantity != 0 {
      expect state_quantity == 1
      expect StateSpend { magic, wire_version, action } = family_decode.state_action_envelope(
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
        deployment.claim_hash,
        action,
      )
    } else {
      expect RequestSpend { magic, wire_version, action } = decode.request_action_envelope(
        raw_redeemer,
      )
      expect magic == wire.magic && wire_version == wire.wire_version
      async.validate_request(tx, own_ref, policy, decode.request(raw), action)
    }
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
        expect StateSpend { magic, wire_version, action: state_action } = family_decode.state_action_envelope(
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
