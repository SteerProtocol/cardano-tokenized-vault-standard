// The Config identity is permanent storage: every spending attempt fails.
// Referencing this UTxO remains possible without invoking a spending branch.

use cardano/transaction.{OutputReference, Transaction}

/// Permanent configuration identity and storage. Profile 0 has no sweep.
validator config_lock {
  spend(
    _datum: Option<Data>,
    _redeemer: Data,
    _ref: OutputReference,
    _tx: Transaction,
  ) {
    False
  }

  else(_) {
    fail
  }
}
