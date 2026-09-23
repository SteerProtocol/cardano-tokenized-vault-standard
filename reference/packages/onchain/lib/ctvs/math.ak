// Integer quote formulas shared by both execution families. Exact-output paths
// round required inputs up; exact-input paths round outputs down. Callers enforce
// executable quantity bounds after the unbounded intermediate arithmetic.

use ctvs/wire.{Terms}

/// Exact, unbounded intermediate arithmetic. Execution validates bounded results.
pub type Quote {
  Quote { gross: Int, net: Int, fee: Int, shares: Int }
}

pub fn ceil_div(n: Int, d: Int) -> Int {
  expect n >= 0 && d > 0
  ( n + d - 1 ) / d
}

/// Add a fee to an amount that excludes fees, rounding the charge up.
pub fn fee_raw(n: Int, bps: Int) -> Int {
  ceil_div(n * bps, 10000)
}

/// Extract the fee from a total that already includes it; the denominator differs.
pub fn fee_total(n: Int, bps: Int) -> Int {
  ceil_div(n * bps, 10000 + bps)
}

pub fn quote_deposit(a: Int, s: Int, t: Terms, gross: Int) -> Quote {
  let fee = fee_total(gross, t.entry_bps)
  let net = gross - fee
  Quote { gross, net, fee, shares: net * ( s + t.virtual_shares ) / ( a + 1 ) }
}

pub fn quote_mint(a: Int, s: Int, t: Terms, shares: Int) -> Quote {
  let net = ceil_div(shares * ( a + 1 ), s + t.virtual_shares)
  let fee = fee_raw(net, t.entry_bps)
  Quote { gross: net + fee, net, fee, shares }
}

pub fn quote_withdraw(a: Int, s: Int, t: Terms, net: Int) -> Quote {
  let fee = fee_raw(net, t.exit_bps)
  let gross = net + fee
  Quote {
    gross,
    net,
    fee,
    shares: ceil_div(gross * ( s + t.virtual_shares ), a + 1),
  }
}

pub fn quote_redeem(a: Int, s: Int, t: Terms, shares: Int) -> Quote {
  let gross = shares * ( a + 1 ) / ( s + t.virtual_shares )
  let fee = fee_total(gross, t.exit_bps)
  Quote { gross, net: gross - fee, fee, shares }
}
