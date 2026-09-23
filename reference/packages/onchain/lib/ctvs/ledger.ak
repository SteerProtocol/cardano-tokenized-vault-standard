// Predicates over the Plutus transaction context, not a replacement for phase-1
// ledger validation. State custody is exact; refund and delivery custody can
// include externally funded top-ups but cannot lose assets from the source.

use aiken/collection/list
use cardano/address.{VerificationKey, from_script}
use cardano/assets.{Value}
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, ScriptPurpose,
  Transaction,
}
use ctvs/validation
use ctvs/wire.{Ada, Asset, Datum, Destination, NativeAsset, State}

pub fn input(tx: Transaction, ref: OutputReference) -> Input {
  expect Some(found) = transaction.find_input(tx.inputs, ref)
  found
}

pub fn output(tx: Transaction, index: Int) -> Output {
  expect index >= 0 && index <= 65535
  expect Some(found) = list.at(tx.outputs, index)
  found
}

/// Resolve exactly one redeemer by semantic purpose, not by a guessed list index.
/// Missing or duplicate matches fail instead of allowing one script's action to
/// stand in for another input's obligation.
pub fn redeemer(tx: Transaction, purpose: ScriptPurpose) -> Data {
  expect [Pair(_, data)] = list.filter(tx.redeemers, fn(p) { p.1st == purpose })
  data
}

pub fn raw_datum(out: Output) -> Data {
  expect InlineDatum(raw) = out.datum
  raw
}

pub fn datum(out: Output) -> Datum {
  let raw = raw_datum(out)
  expect typed: Datum = raw
  typed
}

/// Close every visible extra balance source/sink and unsupported script purpose.
pub fn allowed_purposes(tx: Transaction) -> Bool {
  and {
    tx.withdrawals == [],
    tx.certificates == [],
    tx.votes == [],
    tx.proposal_procedures == [],
    tx.current_treasury_amount == None,
    tx.treasury_donation == None,
    list.all(
      tx.redeemers,
      fn(pair) {
        when pair.1st is {
          transaction.Spend(_) -> True
          transaction.Mint(_) -> True
          _ -> False
        }
      },
    ),
  }
}

pub fn key_input(i: Input) -> Bool {
  when i.output.address.payment_credential is {
    VerificationKey(_) -> True
    _ -> False
  }
}

/// Compare the full Plutus address, including stake credentials, and exact datum
/// form. A datum hash cannot substitute for the prescribed inline datum.
pub fn destination_matches(out: Output, dest: Destination) -> Bool {
  and {
    validation.valid_destination(dest),
    out.address == dest.address,
    out.reference_script == None,
    when dest.datum is {
      None -> out.datum == NoDatum
      Some(d) -> out.datum == InlineDatum(d)
    },
  }
}

/// Refund/delivery preserves every actual source asset, not just the economic
/// amount named by the datum. Extra funding may increase the destination value.
pub fn contains_value(out: Output, source: Output) -> Bool {
  list.all(
    assets.flatten(source.value),
    fn(entry) {
      let (p, n, q) = entry
      assets.quantity_of(out.value, p, n) >= q
    },
  )
}

pub fn economic_value(asset: Asset, quantity: Int, ada: Int) -> Value {
  when asset is {
    Ada -> assets.from_lovelace(quantity + ada)
    NativeAsset { policy_id, asset_name } ->
      assets.from_lovelace(ada) |> assets.add(policy_id, asset_name, quantity)
  }
}

/// Physical backing includes accrued fees, while pricing excludes them. For ADA
/// backing the storage reserve shares the lovelace entry but stays out of pricing.
pub fn state_value(state: Datum, underlying: Asset) -> Value {
  expect  
      State { vault_policy, backing_assets, accrued_fees, storage_lovelace, .. }
    = state
  economic_value(underlying, backing_assets + accrued_fees, storage_lovelace)
    |> assets.add(vault_policy, wire.state_name, 1)
}

/// Locate the consumed State by its permanent asset, then require quantity one
/// at the vault's enterprise script address. Datum resemblance is insufficient;
/// callers must still authenticate its Config and exact accounting/value equation.
pub fn unique_state(tx: Transaction, policy: ByteArray) -> Input {
  expect [found] = list.filter(
    tx.inputs,
    fn(i) { assets.quantity_of(i.output.value, policy, wire.state_name) != 0 },
  )
  expect assets.quantity_of(found.output.value, policy, wire.state_name) == 1
  expect found.output.address == from_script(policy)
  expect found.output.reference_script == None
  found
}

/// Check both logical identity/accounting and closed physical custody. Surplus
/// assets are invalid here even though refund/delivery outputs may carry them:
/// State must contain only the backing/fee/reserve partitions and its identity.
pub fn exact_state_output(
  out: Output,
  policy: ByteArray,
  commitment: ByteArray,
  state: Datum,
  underlying: Asset,
) -> Bool {
  expect State { vault_policy, terms_hash, .. } = state
  let raw: Data = state
  and {
    vault_policy == policy,
    terms_hash == commitment,
    validation.valid_state(state, underlying),
    out.address == from_script(policy),
    out.reference_script == None,
    out.datum == InlineDatum(raw),
    out.value == state_value(state, underlying),
  }
}

/// Economic token quantity is exact; destination storage ADA comes from funding.
pub fn economic_payment(
  out: Output,
  dest: Destination,
  asset: Asset,
  quantity: Int,
) -> Bool {
  and {
    destination_matches(out, dest),
    quantity > 0,
    when asset is {
      Ada ->
        out.value == assets.from_lovelace(assets.lovelace_of(out.value)) && assets.lovelace_of(
          out.value,
        ) >= quantity
      NativeAsset { .. } ->
        out.value == economic_value(
          asset,
          quantity,
          assets.lovelace_of(out.value),
        )
    },
  }
}
