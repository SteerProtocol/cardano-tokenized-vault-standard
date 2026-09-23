// One-shot creation of Config and State identities, anchored to a consumed seed.
// Shared genesis checks authenticate Terms and empty initial accounting; the
// family supplies its own permitted execution modes.

use aiken/collection/list
use cardano/address.{from_script}
use cardano/assets
use cardano/transaction.{OutputReference, Transaction}
use ctvs/decode
use ctvs/ledger
use ctvs/validation
use ctvs/wire.{Config, NativeAsset, State}

/// Mint exactly the permanent identities from key-controlled inputs. Consuming
/// the seed makes initialization one-shot; initial economic share supply is zero.
pub fn validate(
  tx: Transaction,
  policy: ByteArray,
  seed: OutputReference,
  commitment: ByteArray,
  lock_hash: ByteArray,
  config_index: Int,
  state_index: Int,
  permits_modes: fn(Int) -> Bool,
) -> Bool {
  expect and {
      ledger.allowed_purposes(tx),
      config_index != state_index,
      validation.valid_out_ref(seed),
      list.all(tx.inputs, ledger.key_input),
      list.any(tx.inputs, fn(i) { i.output_reference == seed }),
      tx.mint == (
        assets.from_asset(policy, wire.id_name, 1)
          |> assets.add(policy, wire.state_name, 1)
      ),
    }
  let config_out = ledger.output(tx, config_index)
  let config = decode.config(ledger.raw_datum(config_out))
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
      config_out.address == from_script(lock_hash),
      config_out.reference_script == None,
      config_out.value == (
        assets.from_lovelace(storage_lovelace)
          |> assets.add(policy, wire.id_name, 1)
      ),
      when terms.underlying is {
        NativeAsset { policy_id, .. } -> policy_id != policy
        _ -> True
      },
    }
  let state_out = ledger.output(tx, state_index)
  let state = decode.state(ledger.raw_datum(state_out))
  expect  
      State {
        sequence,
        backing_assets,
        economic_supply,
        accrued_fees,
        pause_flags,
        ..
      }
    = state
  and {
    sequence == 0,
    backing_assets == 0,
    economic_supply == 0,
    accrued_fees == 0,
    pause_flags == 0,
    ledger.exact_state_output(
      state_out,
      policy,
      commitment,
      state,
      terms.underlying,
    ),
    list.length(
      list.filter(
        tx.outputs,
        fn(o) { assets.quantity_of(o.value, policy, wire.state_name) != 0 },
      ),
    ) == 1,
    list.length(
      list.filter(
        tx.outputs,
        fn(o) { assets.quantity_of(o.value, policy, wire.id_name) != 0 },
      ),
    ) == 1,
    list.all(
      tx.inputs,
      fn(i) {
        assets.quantity_of(i.output.value, policy, wire.id_name) == 0 && assets.quantity_of(
          i.output.value,
          policy,
          wire.state_name,
        ) == 0
      },
    ),
  }
}
