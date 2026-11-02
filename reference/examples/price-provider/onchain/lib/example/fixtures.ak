// Synthetic ledger contexts, not signed transactions. Placeholder script hashes
// model approved identities; tests invoke compiled handlers explicitly. A script
// reference's hash in this context is not proof of witness resolution by a node.

use aiken/builtin
use cardano/address.{Script, from_script}
use cardano/assets
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Transaction,
}
use ctvs/price.{ConvertToAssets, Price}
use ctvs/wire.{NativeAsset}
use example/lending_a.{Config, MarketState, OnChain}

pub const provider_hash =
  #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

pub const consumer_hash =
  #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

pub const state_hash =
  #"cccccccccccccccccccccccccccccccccccccccccccccccccccccccc"

pub const market_policy =
  #"dddddddddddddddddddddddddddddddddddddddddddddddddddddddd"

pub const receipt_policy =
  #"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"

pub const underlying_policy =
  #"ffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

pub fn ref(index: Int) -> OutputReference {
  OutputReference {
    transaction_id: #"1111111111111111111111111111111111111111111111111111111111111111",
    output_index: index,
  }
}

pub fn config() -> Config {
  Config {
    market_id: NativeAsset {
      policy_id: market_policy,
      asset_name: #"4d41524b4554",
    },
    share_asset: NativeAsset {
      policy_id: receipt_policy,
      asset_name: #"52454345495054",
    },
    underlying_asset: NativeAsset {
      policy_id: underlying_policy,
      asset_name: #"5553444358",
    },
    state_address: from_script(state_hash),
  }
}

pub fn market_datum(backing: Int, supply: Int) -> Data {
  let raw: Data = MarketState {
    accounted_assets: backing,
    receipt_supply: supply,
  }
  raw
}

pub fn claim() -> Price {
  let c = config()
  let evidence: Data = OnChain { market_state_ref: ref(2) }
  Price {
    version: 1,
    market_id: c.market_id,
    share_asset: c.share_asset,
    underlying_asset: c.underlying_asset,
    assertions: [
      ConvertToAssets { shares: 50_000_000_000, assets: 550_000_000 },
    ],
    evidence,
  }
}

/// Both the consumer action and checkpoint datum are exact one-integer records.
pub fn integer_record(value: Int) -> Data {
  builtin.constr_data(0, [builtin.i_data(value)])
}

pub fn source() -> Input {
  Input {
    output_reference: ref(2),
    output: Output {
      address: config().state_address,
      value: assets.from_lovelace(2_000_000)
        |> assets.add(market_policy, #"4d41524b4554", 1),
      datum: InlineDatum(market_datum(1_100_000_000_000, 100_000_000_000_000)),
      reference_script: None,
    },
  }
}

pub fn context() -> Transaction {
  let raw: Data = claim()
  let held = assets.from_lovelace(2_000_000)
    |> assets.add(receipt_policy, #"52454345495054", 50_000_000_000)
  let position = Output {
    address: from_script(consumer_hash),
    value: held,
    datum: InlineDatum(integer_record(0)),
    reference_script: None,
  }
  Transaction {
    ..transaction.placeholder,
    inputs: [Input { output_reference: ref(0), output: position }],
    outputs: [
      Output { ..position, datum: InlineDatum(integer_record(550_000_000)) },
    ],
    reference_inputs: [
      source(),
      Input {
        output_reference: ref(3),
        output: Output {
          address: from_script(state_hash),
          value: assets.from_lovelace(2_000_000),
          datum: NoDatum,
          reference_script: Some(provider_hash),
        },
      },
    ],
    withdrawals: [Pair(Script(provider_hash), 0)],
    redeemers: [
      Pair(transaction.Spend(ref(0)), integer_record(0)),
      Pair(transaction.Withdraw(Script(provider_hash)), raw),
    ],
  }
}

/// Change the same redeemer that both handlers read, never a disconnected copy.
pub fn with_claim(tx: Transaction, claim: Price) -> Transaction {
  let raw: Data = claim
  Transaction {
    ..tx,
    redeemers: [
      Pair(transaction.Spend(ref(0)), integer_record(0)),
      Pair(transaction.Withdraw(Script(provider_hash)), raw),
    ],
  }
}

pub fn with_source(tx: Transaction, output: Output) -> Transaction {
  Transaction {
    ..tx,
    reference_inputs: [Input { output_reference: ref(2), output }],
  }
}
