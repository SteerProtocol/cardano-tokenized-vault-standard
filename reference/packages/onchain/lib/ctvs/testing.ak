// Synthetic transaction contexts shared by both family test suites. Stable
// identities simplify invariant checks; these helpers do not construct signed
// ledger transactions or validate phase-1 witnesses and collateral.

use aiken/collection/list
use cardano/address.{from_script, from_verification_key}
use cardano/assets
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Transaction,
}
use ctvs/deployment
use ctvs/ledger
use ctvs/validation
use ctvs/wire.{
  AnySettler, Asset, Config, Datum, Destination, Initialize, MintPurpose,
  NativeAsset, State, StateAction, StateSpend, Terms,
}

pub const policy = #"11111111111111111111111111111111111111111111111111111111"

pub const unit_policy =
  #"22222222222222222222222222222222222222222222222222222222"

pub const key = #"33333333333333333333333333333333333333333333333333333333"

pub const other_key =
  #"44444444444444444444444444444444444444444444444444444444"

pub const txid =
  #"1111111111111111111111111111111111111111111111111111111111111111"

pub fn ref(index: Int) -> OutputReference {
  OutputReference { transaction_id: txid, output_index: index }
}

pub fn destination() -> Destination {
  Destination { address: from_verification_key(key), datum: None }
}

pub fn terms(underlying: Asset, execution_modes: Int) -> Terms {
  Terms {
    profile: 0,
    network_domain: txid,
    underlying,
    virtual_shares: 1,
    max_backing: None,
    entry_bps: 100,
    exit_bps: 100,
    fee_destination: destination(),
    pause_key: Some(key),
    settlers: AnySettler,
    execution_modes,
    max_batch: 16,
    descriptor_hash: None,
  }
}

pub fn unit() -> Asset {
  NativeAsset { policy_id: unit_policy, asset_name: #"554e4954" }
}

pub fn snapshot(
  t: Terms,
  seq: Int,
  a: Int,
  s: Int,
  f: Int,
  r: Int,
  pause: Int,
) -> Datum {
  State {
    magic: wire.magic,
    wire_version: 2,
    vault_policy: policy,
    terms_hash: validation.terms_hash(t),
    sequence: seq,
    backing_assets: a,
    economic_supply: s,
    accrued_fees: f,
    storage_lovelace: r,
    pause_flags: pause,
  }
}

pub fn state_output(d: Datum, t: Terms) -> Output {
  let raw: Data = d
  Output {
    address: from_script(policy),
    value: ledger.state_value(d, t.underlying),
    datum: InlineDatum(raw),
    reference_script: None,
  }
}

pub fn config_output(t: Terms) -> Output {
  let config: Data = Config {
    magic: wire.magic,
    wire_version: 2,
    vault_policy: policy,
    seed: ref(99),
    terms_hash: validation.terms_hash(t),
    terms: t,
    storage_lovelace: 3000000,
  }
  Output {
    address: from_script(deployment.config_lock_hash),
    datum: InlineDatum(config),
    value: assets.from_lovelace(3000000) |> assets.add(policy, wire.id_name, 1),
    reference_script: None,
  }
}

pub fn envelope(action: StateAction) -> Data {
  let raw: Data = StateSpend { magic: wire.magic, wire_version: 2, action }
  raw
}

/// Balance the complete visible transaction using key funding and a change
/// output. Phase-1 witnesses/collateral are tested separately from these contexts.
pub fn balance(tx: Transaction) -> Transaction {
  let incoming = list.foldl(
    tx.inputs,
    tx.mint,
    fn(i, v) { assets.merge(v, i.output.value) },
  )
  let outgoing = list.foldl(
    tx.outputs,
    assets.from_lovelace(tx.fee),
    fn(o, v) { assets.merge(v, o.value) },
  )
  let change = assets.merge(incoming, assets.negate(outgoing))
  expect
    list.all(
      assets.flatten(change),
      fn(entry) {
        let (_, _, q) = entry
        q > 0
      },
    )
  Transaction {
    ..tx,
    outputs: list.concat(
      tx.outputs,
      [
        Output {
          address: from_verification_key(key),
          value: change,
          datum: NoDatum,
          reference_script: None,
        },
      ],
    ),
  }
}

pub fn change_output(
  tx: Transaction,
  index: Int,
  f: fn(Output) -> Output,
) -> Transaction {
  Transaction {
    ..tx,
    outputs: list.indexed_map(
      tx.outputs,
      fn(i, o) {
        if i == index {
          f(o)
        } else {
          o
        }
      },
    ),
  }
}

pub fn genesis_case(t: Terms) -> (Transaction, Terms) {
  let mint = assets.from_asset(policy, wire.id_name, 1)
    |> assets.add(policy, wire.state_name, 1)
  let r: Data = MintPurpose {
    magic: wire.magic,
    wire_version: 2,
    action: Initialize { config_output: 0, state_output: 1 },
  }
  let tx = balance(
    Transaction {
      ..transaction.placeholder,
      inputs: [
        Input {
          output_reference: ref(99),
          output: Output {
            address: from_verification_key(key),
            value: assets.from_lovelace(10000000),
            datum: NoDatum,
            reference_script: None,
          },
        },
      ],
      outputs: [
        config_output(t),
        state_output(snapshot(t, 0, 0, 0, 0, 3000000, 0), t),
      ],
      mint,
      fee: 400000,
      redeemers: [Pair(transaction.Mint(policy), r)],
    },
  )
  (tx, t)
}
