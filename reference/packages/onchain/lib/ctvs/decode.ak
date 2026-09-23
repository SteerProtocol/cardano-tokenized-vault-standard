// Decode only the datum or redeemer role expected by the calling handler.
// Public constructor tags are preserved even though private records are rebased
// for exact field checks; Request economics stay opaque until settlement.

use aiken/builtin
use aiken/collection/list
use cardano/transaction.{OutputReference}
use ctvs/wire.{
  ActionEnvelope, Asset, Claim, ClaimAction, ClaimSpend, Config, Datum,
  Destination, MintAction, MintPurpose, Recovery, Request, RequestAction,
  RequestSpend, State, StateAction, StateSpend, Terms,
}

/// Purpose-scoped exact decoders. Joint public enums retain their wire tags,
/// while each entrypoint validates only its expected role's recursive schema.
/// Rebase only after checking the expected public tag and exact field count.
/// Each private single-constructor record below has tag zero by construction.
fn record(raw: Data, expected_tag: Int, field_count: Int) -> Data {
  let Pair(tag, fields) = builtin.un_constr_data(raw)
  expect tag == expected_tag && list.length(fields) == field_count
  builtin.constr_data(0, fields)
}

type StateFields {
  StateFields {
    magic: ByteArray,
    wire_version: Int,
    vault_policy: ByteArray,
    terms_hash: ByteArray,
    sequence: Int,
    backing_assets: Int,
    economic_supply: Int,
    accrued_fees: Int,
    storage_lovelace: Int,
    pause_flags: Int,
  }
}

type ConfigFields {
  ConfigFields {
    magic: ByteArray,
    wire_version: Int,
    vault_policy: ByteArray,
    seed: OutputReference,
    terms_hash: ByteArray,
    terms: Terms,
    storage_lovelace: Int,
  }
}

type RequestFields {
  RequestFields {
    magic: ByteArray,
    wire_version: Int,
    recovery: Recovery,
    economic_body: Data,
  }
}

type ClaimFields {
  ClaimFields {
    magic: ByteArray,
    wire_version: Int,
    vault_policy: ByteArray,
    request_ref: OutputReference,
    state_ref: OutputReference,
    terms_hash: ByteArray,
    asset: Asset,
    economic_quantity: Int,
    receiver: Destination,
    carried_lovelace: Int,
  }
}

type ActionFields<action> {
  ActionFields { magic: ByteArray, wire_version: Int, action: action }
}

/// Require the public State constructor and exactly ten recursively typed fields.
/// This establishes schema only: policy provenance, value custody and bounded
/// accounting must still be checked against the consumed State output.
pub fn state(raw: Data) -> Datum {
  expect fields: StateFields = record(raw, 0, 10)
  State {
    magic: fields.magic,
    wire_version: fields.wire_version,
    vault_policy: fields.vault_policy,
    terms_hash: fields.terms_hash,
    sequence: fields.sequence,
    backing_assets: fields.backing_assets,
    economic_supply: fields.economic_supply,
    accrued_fees: fields.accrued_fees,
    storage_lovelace: fields.storage_lovelace,
    pause_flags: fields.pause_flags,
  }
}

/// Decode Config and its nested Terms while retaining the public Config tag.
/// The permanent ID token, lock address and Terms commitment are authenticated
/// by genesis/state handlers rather than by this structural conversion.
pub fn config(raw: Data) -> Datum {
  expect fields: ConfigFields = record(raw, 3, 7)
  Config {
    magic: fields.magic,
    wire_version: fields.wire_version,
    vault_policy: fields.vault_policy,
    seed: fields.seed,
    terms_hash: fields.terms_hash,
    terms: fields.terms,
    storage_lovelace: fields.storage_lovelace,
  }
}

/// The economic body remains uninterpreted, including unknown constructors and
/// values outside settlement limits. Only Recovery is recursively decoded here.
pub fn request(raw: Data) -> Datum {
  expect fields: RequestFields = record(raw, 1, 4)
  Request {
    magic: fields.magic,
    wire_version: fields.wire_version,
    recovery: fields.recovery,
    economic_body: fields.economic_body,
  }
}

/// Decode the fixed payout and its stored origin references. Well-formed origins
/// are not proof of settlement lineage; delivery checks actual source custody,
/// while offchain provenance follows the transaction that created the Claim.
pub fn claim(raw: Data) -> Datum {
  expect fields: ClaimFields = record(raw, 2, 10)
  Claim {
    magic: fields.magic,
    wire_version: fields.wire_version,
    vault_policy: fields.vault_policy,
    request_ref: fields.request_ref,
    state_ref: fields.state_ref,
    terms_hash: fields.terms_hash,
    asset: fields.asset,
    economic_quantity: fields.economic_quantity,
    receiver: fields.receiver,
    carried_lovelace: fields.carried_lovelace,
  }
}

/// Decode the shared State action union without renumbering its public tags.
/// CTVS-2 uses its narrower family decoder so direct-action payloads are rejected
/// before their nested fields are interpreted. Magic/version checks remain at dispatch.
pub fn state_action_envelope(raw: Data) -> ActionEnvelope {
  expect fields: ActionFields<StateAction> = record(raw, 0, 3)
  StateSpend {
    magic: fields.magic,
    wire_version: fields.wire_version,
    action: fields.action,
  }
}

/// Decode only Request acknowledgment/cancellation/expiry actions. Referenced
/// inputs and refund outputs are resolved later against the actual transaction.
pub fn request_action_envelope(raw: Data) -> ActionEnvelope {
  expect fields: ActionFields<RequestAction> = record(raw, 1, 3)
  RequestSpend {
    magic: fields.magic,
    wire_version: fields.wire_version,
    action: fields.action,
  }
}

/// Decode a Claim delivery list without yet proving sorted, unique and complete
/// input coverage. The delivery handler enforces those transaction-wide conditions.
pub fn claim_action_envelope(raw: Data) -> ActionEnvelope {
  expect fields: ActionFields<ClaimAction> = record(raw, 2, 3)
  ClaimSpend {
    magic: fields.magic,
    wire_version: fields.wire_version,
    action: fields.action,
  }
}

/// Distinguish initialization from a supply update before mint policy checks.
/// Initialization consumes the seed; an update must couple to a State spend.
pub fn mint_action_envelope(raw: Data) -> ActionEnvelope {
  expect fields: ActionFields<MintAction> = record(raw, 3, 3)
  MintPurpose {
    magic: fields.magic,
    wire_version: fields.wire_version,
    action: fields.action,
  }
}
