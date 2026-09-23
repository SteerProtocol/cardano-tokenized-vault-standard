// Synchronous family transitions: one direct operation or administration step
// consumes State. Economic backing, accrued fees and storage ADA stay distinct
// even when all three are physically held as lovelace.

use aiken/collection/list
use cardano/transaction.{OutputReference, Transaction}
use ctvs/ledger
use ctvs/math.{Quote}
use ctvs/state_core
use ctvs/validation
use ctvs/wire.{
  Batch, CollectFees, Datum, Deposit, Destination, MintShares, NativeAsset,
  Redeem, SetPause, State, StateAction, Terms, TopUpReserve, Withdraw,
}

/// This family supports direct paths only. One-sided modes are currently accepted
/// capabilities, not a guarantee that a vault has a complete entry/exit lifecycle.
pub fn permits_modes(modes: Int) -> Bool {
  modes >= 1 && modes <= 3
}

pub fn valid_action(action: StateAction) -> Bool {
  when action is {
    Batch { .. } -> False
    _ -> validation.valid_state_action(action)
  }
}

pub fn output_index(action: StateAction) -> Int {
  when action is {
    Deposit { state_output, .. } |
    MintShares { state_output, .. } |
    Withdraw { state_output, .. } |
    Redeem { state_output, .. } |
    CollectFees { state_output, .. } |
    TopUpReserve { state_output, .. } |
    SetPause { state_output, .. } -> state_output
    _ -> fail
  }
}

/// Apply an already quoted direct operation after checking mode, pause and payout.
/// User slippage bounds are checked by the selecting action branch. Receiver
/// storage ADA beyond the economic payout is externally funded; State reserves stay unchanged.
/// The returned datum is later matched against exact successor custody and mint.
fn direct_next(
  tx: Transaction,
  old: Datum,
  terms: Terms,
  quote: Quote,
  entering: Bool,
  receiver: Destination,
  receiver_output: Int,
  state_output: Int,
) -> Datum {
  expect  
      State {
        vault_policy,
        backing_assets: a,
        economic_supply: s,
        accrued_fees: f,
        storage_lovelace: r,
        pause_flags,
        ..
      }
    = old
  expect and {
      validation.positive_q(quote.gross),
      validation.positive_q(quote.net),
      validation.positive_q(quote.shares),
      validation.q(quote.fee),
      receiver_output != state_output,
      if entering {
        terms.execution_modes % 2 == 1 && pause_flags % 2 == 0
      } else {
        terms.execution_modes / 2 % 2 == 1 && pause_flags / 2 == 0
      },
    }
  let payout_asset = if entering {
    NativeAsset { policy_id: vault_policy, asset_name: wire.share_name }
  } else {
    terms.underlying
  }
  let payout = if entering {
    quote.shares
  } else {
    quote.net
  }
  expect
    ledger.economic_payment(
      ledger.output(tx, receiver_output),
      receiver,
      payout_asset,
      payout,
    )
  // Entry adds net backing plus accrued fees; exit removes gross backing while
  // retaining the exit fee. Neither path changes storage reserves.
  if entering {
    state_core.next_state(
      old,
      a + quote.net,
      s + quote.shares,
      f + quote.fee,
      r,
      pause_flags,
    )
  } else {
    expect quote.gross <= a && quote.shares <= s
    state_core.next_state(
      old,
      a - quote.gross,
      s - quote.shares,
      f + quote.fee,
      r,
      pause_flags,
    )
  }
}

/// Authenticate the consumed State and referenced Config before selecting economics.
/// Other consumed inputs must be key-controlled, preventing additional script
/// obligations from supplying hidden value paths. Compute the expected transition
/// independently of the proposed output, then verify custody and share issuance.
pub fn validate(
  tx: Transaction,
  own_ref: OutputReference,
  policy: ByteArray,
  seed: OutputReference,
  commitment: ByteArray,
  lock_hash: ByteArray,
  action: StateAction,
) -> Bool {
  expect ledger.allowed_purposes(tx) && valid_action(action)
  let (_, old, terms) = state_core.authenticate(
    tx,
    own_ref,
    policy,
    seed,
    commitment,
    lock_hash,
    permits_modes,
  )
  expect State { backing_assets: a, economic_supply: s, .. } = old
  expect
    list.all(
      tx.inputs,
      fn(i) { i.output_reference == own_ref || ledger.key_input(i) },
    )
  let expected = when action is {
    Deposit {
      receiver,
      gross_assets,
      min_shares,
      state_output,
      receiver_output,
    } -> {
      let quote = math.quote_deposit(a, s, terms, gross_assets)
      expect quote.shares >= min_shares
      direct_next(
        tx,
        old,
        terms,
        quote,
        True,
        receiver,
        receiver_output,
        state_output,
      )
    }
    MintShares {
      receiver,
      target_shares,
      max_assets,
      state_output,
      receiver_output,
    } -> {
      let quote = math.quote_mint(a, s, terms, target_shares)
      expect quote.gross <= max_assets
      direct_next(
        tx,
        old,
        terms,
        quote,
        True,
        receiver,
        receiver_output,
        state_output,
      )
    }
    Withdraw { receiver, net_assets, max_shares, state_output, receiver_output } -> {
      let quote = math.quote_withdraw(a, s, terms, net_assets)
      expect quote.shares <= max_shares
      direct_next(
        tx,
        old,
        terms,
        quote,
        False,
        receiver,
        receiver_output,
        state_output,
      )
    }
    Redeem { receiver, shares, min_assets, state_output, receiver_output } -> {
      let quote = math.quote_redeem(a, s, terms, shares)
      expect quote.net >= min_assets
      direct_next(
        tx,
        old,
        terms,
        quote,
        False,
        receiver,
        receiver_output,
        state_output,
      )
    }
    CollectFees { .. } | TopUpReserve { .. } | SetPause { .. } ->
      state_core.administrative_next(tx, old, terms, action)
    _ -> fail
  }
  state_core.validate_successor(
    tx,
    own_ref,
    policy,
    commitment,
    terms,
    old,
    expected,
    output_index(action),
  )
}
