use cardano/assets.{PolicyId}
use cardano/transaction.{Transaction}

/// Native share minting and burning policy.
///
/// Production code must be coupled to the state transition and prove:
/// new_total_shares = old_total_shares + minted_shares - burned_shares.
/// It must reject share minting without the authenticated state input.
validator ctvs_share {
  mint(_redeemer: Data, _policy_id: PolicyId, _self: Transaction) {
    todo @"CTVS planning scaffold: couple share supply to the state transition"
  }
}
