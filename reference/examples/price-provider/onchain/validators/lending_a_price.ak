// Real withdrawal entrypoint for the hypothetical LendingA example. It reads
// evidence supplied by the builder; it cannot fetch UTxOs or call a quote API.

use aiken/collection/list
use cardano/address.{Credential, Script}
use cardano/transaction.{Transaction}
use ctvs/price
use example/lending_a.{Config}

validator lending_a_price(config: Config) {
  withdraw(raw_redeemer: Data, credential: Credential, tx: Transaction) {
    expect Script(_) = credential
    expect [Pair(_, amount)] = list.filter(
      tx.withdrawals,
      fn(entry) { entry.1st == credential },
    )
    expect amount == 0
    let claim = price.decode(raw_redeemer)
    lending_a.verify(claim, config, tx)
  }

  else(_) {
    fail
  }
}
