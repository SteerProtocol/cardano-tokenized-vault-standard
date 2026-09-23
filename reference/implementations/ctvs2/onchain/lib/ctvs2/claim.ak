// Fixed Claim delivery is independent of live State and Config. Claims from
// different vaults at this delivery script may travel together, but each keeps
// its own receiver output and all actual source assets, including surplus.

use aiken/builtin
use aiken/collection/list
use cardano/address.{Script}
use cardano/assets
use cardano/transaction.{
  InlineDatum, Input, OutputReference, Spend, Transaction,
}
use ctvs/decode
use ctvs/ledger
use ctvs/validation
use ctvs/wire.{
  ActionEnvelope, Claim, ClaimAction, ClaimSpend, Deliver, DeliverEntry,
}

pub fn sorted_refs(refs: List<OutputReference>) -> Bool {
  when refs is {
    [] -> True
    [one] -> validation.valid_out_ref(one)
    [first, second, ..rest] -> and {
        validation.valid_out_ref(first),
        if first.transaction_id == second.transaction_id {
          first.output_index < second.output_index
        } else {
          builtin.less_than_bytearray(
            first.transaction_id,
            second.transaction_id,
          )
        },
        sorted_refs([second, ..rest]),
      }
  }
}

fn claim_input(input: Input, script_hash: ByteArray) -> Bool {
  input.output.address.payment_credential == Script(script_hash)
}

/// Prove one delivery against the source's fixed receiver and actual asset inventory.
/// All consumed Claim inputs at this script carry the same semantic action list; this prevents
/// each Claim from presenting a different allocation that reuses another payment.
/// Extra receiver funding is allowed, but source ADA cannot pay the transaction fee.
fn deliver_one(
  tx: Transaction,
  script_hash: ByteArray,
  entry: DeliverEntry,
  expected_redeemer: ActionEnvelope,
) -> Bool {
  let source = ledger.input(tx, entry.claim_ref)
  expect InlineDatum(raw_claim) = source.output.datum
  let datum = decode.claim(raw_claim)
  expect Claim { receiver, .. } = datum
  let actual_redeemer: Data = ledger.redeemer(tx, Spend(entry.claim_ref))
  let expected_data: Data = expected_redeemer
  and {
    claim_input(source, script_hash),
    source.output.reference_script == None,
    validation.valid_claim(datum),
    actual_redeemer == expected_data,
    ledger.destination_matches(
      ledger.output(tx, entry.receiver_output),
      receiver,
    ),
    ledger.contains_value(
      ledger.output(tx, entry.receiver_output),
      source.output,
    ),
  }
}

/// Every ordinary input at this Q must occur exactly once in the same semantic
/// delivery list. Each obligation is allocated its own receiver output.
pub fn validate_delivery(
  tx: Transaction,
  own_ref: OutputReference,
  action: ClaimAction,
) -> Bool {
  let own = ledger.input(tx, own_ref)
  expect Script(script_hash) = own.output.address.payment_credential
  let Deliver { entries } = action
  let refs = list.map(entries, fn(entry) { entry.claim_ref })
  let indices = list.map(entries, fn(entry) { entry.receiver_output })
  let claims = list.filter(
    tx.inputs,
    fn(input) { claim_input(input, script_hash) },
  )
  let expected_redeemer = ClaimSpend {
    magic: wire.magic,
    wire_version: wire.wire_version,
    action,
  }
  and {
    list.length(entries) >= 1,
    list.length(entries) <= 16,
    sorted_refs(refs),
    list.has(refs, own_ref),
    list.length(claims) == list.length(entries),
    list.all(claims, fn(input) { list.has(refs, input.output_reference) }),
    list.length(list.unique(indices)) == list.length(indices),
    ledger.allowed_purposes(tx),
    assets.is_zero(tx.mint),
    list.all(
      tx.inputs,
      fn(input) { claim_input(input, script_hash) || ledger.key_input(input) },
    ),
    list.all(
      entries,
      fn(entry) { deliver_one(tx, script_hash, entry, expected_redeemer) },
    ),
  }
}
