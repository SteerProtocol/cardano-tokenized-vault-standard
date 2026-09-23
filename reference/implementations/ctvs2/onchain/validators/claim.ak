// Parameter-free Claim spending entrypoint. Delivery resolves the consumed
// outputs itself and enforces their full obligations through one shared list.

use cardano/transaction.{OutputReference, Transaction}
use ctvs/decode
use ctvs/wire.{ClaimSpend}
use ctvs2/claim

validator claim_guard {
  spend(
    _datum: Option<Data>,
    redeemer: Data,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    let envelope = decode.claim_action_envelope(redeemer)
    expect ClaimSpend { magic, wire_version, action } = envelope
    and {
      magic == wire.magic,
      wire_version == wire.wire_version,
      claim.validate_delivery(tx, own_ref, action),
    }
  }

  else(_) {
    fail
  }
}
