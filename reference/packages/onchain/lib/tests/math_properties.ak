// Generated economic checks use integer inequalities and conservation as their
// oracle, rather than copying quote implementations. These test arithmetic in
// isolation, so generated Terms need not select an executable family mode.

use aiken/fuzz
use ctvs/math
use ctvs/testing
use ctvs/wire.{Terms}

type Scenario {
  Scenario {
    backing: Int,
    supply: Int,
    virtual_shares: Int,
    amount: Int,
    entry_bps: Int,
    exit_bps: Int,
  }
}

fn rate() -> Fuzzer<Int> {
  let n <- fuzz.map(fuzz.int_between(0, 11))
  when n is {
    0 -> 0
    1 -> 9999
    _ -> n * 811
  }
}

fn scenario() -> Fuzzer<Scenario> {
  let backing <- fuzz.and_then(fuzz.int_between(0, 1_000_000_000))
  let supply <- fuzz.and_then(fuzz.int_between(1, 1_000_000_000))
  let virtual_shares <- fuzz.and_then(fuzz.int_between(1, 1_000_000))
  let amount <- fuzz.and_then(fuzz.int_between(1, 1_000_000_000))
  let entry_bps <- fuzz.and_then(rate())
  let exit_bps <- fuzz.map(rate())
  Scenario { backing, supply, virtual_shares, amount, entry_bps, exit_bps }
}

fn terms(s: Scenario) -> Terms {
  Terms {
    ..testing.terms(testing.unit(), 15),
    virtual_shares: s.virtual_shares,
    entry_bps: s.entry_bps,
    exit_bps: s.exit_bps,
  }
}

fn labels(s: Scenario) {
  fuzz.label(
    if s.entry_bps == 0 {
      @"zero entry fee"
    } else {
      @"positive entry fee"
    },
  )
  fuzz.label(
    if s.exit_bps == 0 {
      @"zero exit fee"
    } else {
      @"positive exit fee"
    },
  )
}

test deposit_quote_preserves_gross_assets_and_rounds_against_dilution(
  s via scenario(),
) {
  labels(s)
  let q = math.quote_deposit(s.backing, s.supply, terms(s), s.amount)
  let x = s.backing + 1
  let y = s.supply + s.virtual_shares
  and {
    q.net + q.fee == s.amount,
    q.net >= 0,
    q.fee >= 0,
    q.shares * x <= q.net * y,
    q.net * y < ( q.shares + 1 ) * x,
  }
}

test redeem_quote_preserves_gross_assets_and_never_debits_more_than_backing(
  s via scenario(),
) {
  labels(s)
  let shares = 1 + s.amount % s.supply
  let q = math.quote_redeem(s.backing, s.supply, terms(s), shares)
  let x = s.backing + 1
  let y = s.supply + s.virtual_shares
  and {
    q.net + q.fee == q.gross,
    q.net >= 0,
    q.fee >= 0,
    q.gross <= s.backing,
    q.gross * y <= shares * x,
    shares * x < ( q.gross + 1 ) * y,
  }
}

test deposit_then_redeem_new_shares_cannot_extract_profit(s via scenario()) {
  labels(s)
  let t = terms(s)
  let deposit = math.quote_deposit(s.backing, s.supply, t, s.amount)
  if deposit.shares == 0 {
    fuzz.label(@"zero issuance, economic action rejected")
    True
  } else {
    fuzz.label(@"positive issuance round trip")
    let redeem = math.quote_redeem(
      s.backing + deposit.net,
      s.supply + deposit.shares,
      t,
      deposit.shares,
    )
    and {
      redeem.net <= s.amount,
      redeem.gross <= deposit.net,
      s.backing + deposit.net - redeem.gross >= s.backing,
    }
  }
}

test increased_deposit_cannot_reduce_issued_shares(s via scenario()) {
  let t = terms(s)
  let first = math.quote_deposit(s.backing, s.supply, t, s.amount)
  let second = math.quote_deposit(s.backing, s.supply, t, s.amount + 1)
  second.net >= first.net && second.shares >= first.shares
}

test increased_redemption_cannot_reduce_net_payout(s via scenario()) {
  let t = terms(s)
  let first = math.quote_redeem(s.backing, s.supply, t, s.amount)
  let second = math.quote_redeem(s.backing, s.supply, t, s.amount + 1)
  second.gross >= first.gross && second.net >= first.net
}

test exact_share_mint_requires_sufficient_backing_increase(s via scenario()) {
  let q = math.quote_mint(s.backing, s.supply, terms(s), s.amount)
  let x = s.backing + 1
  let y = s.supply + s.virtual_shares
  and {
    q.shares == s.amount,
    q.gross == q.net + q.fee,
    q.net * y >= s.amount * x,
    ( q.net - 1 ) * y < s.amount * x,
  }
}

test exact_asset_withdrawal_requires_sufficient_share_extinction(
  s via scenario(),
) {
  let q = math.quote_withdraw(s.backing, s.supply, terms(s), s.amount)
  let x = s.backing + 1
  let y = s.supply + s.virtual_shares
  and {
    q.net == s.amount,
    q.gross == q.net + q.fee,
    q.shares * x >= q.gross * y,
    ( q.shares - 1 ) * x < q.gross * y,
  }
}

test mixed_snapshot_accounting_preserves_underlying_and_supply(s via scenario()) {
  let t = terms(s)
  let deposit = math.quote_deposit(s.backing, s.supply, t, s.amount)
  let redeem = math.quote_redeem(
    s.backing,
    s.supply,
    t,
    1 + s.amount % s.supply,
  )
  let backing = s.backing + deposit.net - redeem.gross
  let fees = deposit.fee + redeem.fee
  let supply = s.supply + deposit.shares - redeem.shares
  and {
    backing >= 0,
    supply >= 0,
    backing + fees == s.backing + deposit.gross - redeem.net,
    supply - s.supply == deposit.shares - redeem.shares,
  }
}
