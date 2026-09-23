use cardano/transaction.{OutputReference, Transaction}

/// The authenticated singleton state validator.
///
/// This interface is deliberately inert. Its production implementation must
/// enforce the CTVS-1 transition rules in docs/02-transaction-shapes.md:
/// one state-NFT input, one continuing state-NFT output, immutable vault
/// configuration reference input, closed state-value equation, accrued-fee
/// delta, exact OutputDestination constraints, slippage bounds,
/// limits, and action-specific authorization.
validator ctvs_state {
  spend(_datum: Option<Data>, _redeemer: Data, _own_ref: OutputReference, _self: Transaction) {
    todo @"CTVS planning scaffold: implement after v0 wire-format review and transaction test vectors"
  }
}
