// Minimal receipt valuation checkpoint, not a SteelSwap vault implementation.
// Preserve the input's full custody and write its verified receipt value into
// a successor datum. No deposits, share issuance, withdrawals or borrowing here.

use aiken/builtin
use aiken/collection/list
use cardano/address.{Script}
use cardano/assets
use cardano/transaction.{InlineDatum, OutputReference, Transaction}
use ctvs/ledger
use ctvs/price.{ConvertToAssets}
use ctvs/validation
use ctvs/wire.{Asset, NativeAsset}

/// Consumer-owned checkpoint and action schema, independent of native evidence.
fn integer_field(raw: Data) -> Int {
  let Pair(tag, fields) = builtin.un_constr_data(raw)
  expect tag == 0
  expect [value] = fields
  expect number: Int = value
  number
}

validator receipt_consumer(
  provider_hash: ByteArray,
  market_id: Asset,
  share_asset: Asset,
  underlying_asset: Asset,
) {
  spend(
    supplied: Option<Data>,
    raw_redeemer: Data,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    expect validation.bytes28(provider_hash)
    let own = ledger.input(tx, own_ref)
    expect InlineDatum(old) = own.output.datum
    expect supplied == Some(old)
    // One receipt position per invocation prevents reusing a successor for two
    // identical consumed positions. Other protocol inputs may still coexist.
    expect [single] = list.filter(
      tx.inputs,
      fn(input) { input.output.address == own.output.address },
    )
    expect single.output_reference == own_ref
    let credential = Script(provider_hash)
    expect [Pair(_, amount)] = list.filter(
      tx.withdrawals,
      fn(entry) { entry.1st == credential },
    )
    expect amount == 0
    let claim = price.decode(
      ledger.redeemer(tx, transaction.Withdraw(credential)),
    )
    expect claim.market_id == market_id
    expect claim.share_asset == share_asset
    expect claim.underlying_asset == underlying_asset
    expect NativeAsset { policy_id, asset_name } = share_asset
    let held = assets.quantity_of(own.output.value, policy_id, asset_name)
    expect held > 0
    expect [ConvertToAssets { assets: value, .. }] = list.filter(
      claim.assertions,
      fn(assertion) {
        when assertion is {
          ConvertToAssets { shares, .. } -> shares == held
          _ -> False
        }
      },
    )
    let output_index = integer_field(raw_redeemer)
    let next = ledger.output(tx, output_index)
    expect [successor] = list.filter(
      tx.outputs,
      fn(output) { output.address == own.output.address },
    )
    expect successor == next
    expect next.address == own.output.address && next.value == own.output.value
    expect next.reference_script == None
    expect InlineDatum(datum) = next.datum
    let recorded_value = integer_field(datum)
    // The provider, independently invoked by the ledger, proves economic truth.
    // This consumer proves selection, custody and use of that same assertion.
    recorded_value == value
  }

  else(_) {
    fail
  }
}
