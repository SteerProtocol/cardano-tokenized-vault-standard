use ctvs/types.{FeeConfig, Quote, VaultState}

/// Basis points denominator used by the CTVS-1 accrued-fee model.
pub const fee_scale = 10_000

pub fn valid_fee_config(fees: FeeConfig) -> Bool {
  fees.entry_fee_bps >= 0 &&
    fees.entry_fee_bps < fee_scale &&
    fees.exit_fee_bps >= 0 &&
    fees.exit_fee_bps < fee_scale
}

pub fn valid_state(state: VaultState) -> Bool {
  state.version >= 0 &&
    state.total_assets >= 0 &&
    state.total_shares >= 0 &&
    state.virtual_assets > 0 &&
    state.virtual_shares > 0 &&
    state.accounting_epoch >= 0
}

pub fn zero_quote() -> Quote {
  Quote {
    gross_assets: 0,
    net_assets: 0,
    fee_assets: 0,
    shares: 0,
  }
}

/// Ceiling division for non-negative values. The caller must first validate
/// denominator and input range; returning zero here makes invalid planning
/// inputs visibly non-executable rather than relying on a division failure.
pub fn ceil_div(numerator: Int, denominator: Int) -> Int {
  if numerator <= 0 || denominator <= 0 {
    0
  } else {
    (numerator + denominator - 1) / denominator
  }
}

pub fn floor_div(numerator: Int, denominator: Int) -> Int {
  if numerator <= 0 || denominator <= 0 {
    0
  } else {
    numerator / denominator
  }
}

/// Fee-free, average-price conversion. This is the Cardano equivalent of
/// ERC-4626 `convertToShares`, evaluated against one authenticated state UTxO.
pub fn convert_to_shares_down(state: VaultState, assets: Int) -> Int {
  floor_div(
    assets * (state.total_shares + state.virtual_shares),
    state.total_assets + state.virtual_assets,
  )
}

pub fn convert_to_shares_up(state: VaultState, assets: Int) -> Int {
  ceil_div(
    assets * (state.total_shares + state.virtual_shares),
    state.total_assets + state.virtual_assets,
  )
}

/// Fee-free, average-price conversion. This is the Cardano equivalent of
/// ERC-4626 `convertToAssets`, evaluated against one authenticated state UTxO.
pub fn convert_to_assets_down(state: VaultState, shares: Int) -> Int {
  floor_div(
    shares * (state.total_assets + state.virtual_assets),
    state.total_shares + state.virtual_shares,
  )
}

pub fn convert_to_assets_up(state: VaultState, shares: Int) -> Int {
  ceil_div(
    shares * (state.total_assets + state.virtual_assets),
    state.total_shares + state.virtual_shares,
  )
}

/// Fee charged on an amount quoted before the fee is added.
pub fn fee_on_raw(amount: Int, fee_bps: Int) -> Int {
  ceil_div(amount * fee_bps, fee_scale)
}

/// Fee included inside a user-supplied gross amount.
pub fn fee_on_total(amount: Int, fee_bps: Int) -> Int {
  ceil_div(amount * fee_bps, fee_scale + fee_bps)
}

/// Exact asset input. Shares round down so execution never returns more shares
/// than the preview, matching ERC-4626 deposit semantics.
pub fn quote_deposit(
  state: VaultState,
  fees: FeeConfig,
  gross_assets: Int,
) -> Quote {
  if !valid_state(state) || !valid_fee_config(fees) || gross_assets <= 0 {
    zero_quote()
  } else {
    let fee_assets = fee_on_total(gross_assets, fees.entry_fee_bps)
    let net_assets = gross_assets - fee_assets
    Quote {
      gross_assets,
      net_assets,
      fee_assets,
      shares: convert_to_shares_down(state, net_assets),
    }
  }
}

/// Exact share output. Required assets round up so execution never asks for
/// fewer assets than the preview, matching ERC-4626 mint semantics.
pub fn quote_mint(
  state: VaultState,
  fees: FeeConfig,
  target_shares: Int,
) -> Quote {
  if !valid_state(state) || !valid_fee_config(fees) || target_shares <= 0 {
    zero_quote()
  } else {
    let net_assets = convert_to_assets_up(state, target_shares)
    let fee_assets = fee_on_raw(net_assets, fees.entry_fee_bps)
    Quote {
      gross_assets: net_assets + fee_assets,
      net_assets,
      fee_assets,
      shares: target_shares,
    }
  }
}

/// Exact net asset output. Required shares round up so execution never burns
/// fewer shares than the preview, matching ERC-4626 withdraw semantics.
pub fn quote_withdraw(
  state: VaultState,
  fees: FeeConfig,
  net_assets: Int,
) -> Quote {
  if !valid_state(state) || !valid_fee_config(fees) || net_assets <= 0 {
    zero_quote()
  } else {
    let fee_assets = fee_on_raw(net_assets, fees.exit_fee_bps)
    let gross_assets = net_assets + fee_assets
    Quote {
      gross_assets,
      net_assets,
      fee_assets,
      shares: convert_to_shares_up(state, gross_assets),
    }
  }
}

/// Exact share input. Net asset output rounds down so execution never returns
/// more assets than the preview, matching ERC-4626 redeem semantics.
pub fn quote_redeem(
  state: VaultState,
  fees: FeeConfig,
  shares: Int,
) -> Quote {
  if !valid_state(state) || !valid_fee_config(fees) || shares <= 0 {
    zero_quote()
  } else {
    let gross_assets = convert_to_assets_down(state, shares)
    let fee_assets = fee_on_total(gross_assets, fees.exit_fee_bps)
    Quote {
      gross_assets,
      net_assets: gross_assets - fee_assets,
      fee_assets,
      shares,
    }
  }
}
