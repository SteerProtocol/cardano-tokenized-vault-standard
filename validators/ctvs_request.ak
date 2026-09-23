use cardano/transaction.{OutputReference, Transaction}

/// Optional CTVS-2 request, cancellation, and claim interface.
///
/// Production code must identify requests using the originating OutputReference
/// or an authenticated request beacon. It must never infer identity from an
/// input or output position within a batch transaction.
validator ctvs_request {
  spend(_datum: Option<Data>, _redeemer: Data, _own_ref: OutputReference, _self: Transaction) {
    todo @"CTVS planning scaffold: implement after CTVS-1 is independently reviewed"
  }
}
