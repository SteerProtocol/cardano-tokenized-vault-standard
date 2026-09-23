use ctvs/math
use ctvs/types.{AssetId, FeeConfig, Open, VaultState}

const asset = AssetId { policy_id: "", asset_name: "USDM" }
const share = AssetId { policy_id: "vault-policy", asset_name: "vUSDM" }

const no_fees = FeeConfig { entry_fee_bps: 0, exit_fee_bps: 0 }
const one_percent_fees = FeeConfig { entry_fee_bps: 100, exit_fee_bps: 100 }

const empty_state =
  VaultState {
    version: 0,
    vault_id: AssetId { policy_id: "factory-policy", asset_name: "vault-1" },
    underlying: asset,
    share,
    total_assets: 0,
    total_shares: 0,
    virtual_assets: 1,
    virtual_shares: 1,
    accounting_epoch: 0,
    status: Open,
  }

const even_state =
  VaultState {
    version: 0,
    vault_id: AssetId { policy_id: "factory-policy", asset_name: "vault-1" },
    underlying: asset,
    share,
    total_assets: 1_000_000,
    total_shares: 1_000_000,
    virtual_assets: 1,
    virtual_shares: 1,
    accounting_epoch: 0,
    status: Open,
  }

const uneven_state =
  VaultState {
    version: 0,
    vault_id: AssetId { policy_id: "factory-policy", asset_name: "vault-1" },
    underlying: asset,
    share,
    total_assets: 3,
    total_shares: 2,
    virtual_assets: 1,
    virtual_shares: 1,
    accounting_epoch: 0,
    status: Open,
  }

test first_deposit_is_one_to_one_at_the_declared_bootstrap_rate() {
  let quote = math.quote_deposit(empty_state, no_fees, 1_000_000)
  quote.net_assets == 1_000_000 && quote.shares == 1_000_000
}

test direct_deposit_uses_floor_rounding() {
  math.convert_to_shares_down(uneven_state, 1) == 0
}

test exact_withdraw_uses_ceiling_rounding() {
  math.convert_to_shares_up(uneven_state, 1) == 1
}

test one_percent_entry_fee_is_included_in_deposit_quote() {
  let quote = math.quote_deposit(empty_state, one_percent_fees, 1_000)
  quote.fee_assets == 10 && quote.net_assets == 990 && quote.shares == 990
}

test one_percent_entry_fee_is_added_to_exact_mint_quote() {
  let quote = math.quote_mint(even_state, one_percent_fees, 1_000)
  quote.gross_assets == 1_010 && quote.net_assets == 1_000 && quote.fee_assets == 10
}

test one_percent_exit_fee_is_added_to_exact_withdraw_quote() {
  let quote = math.quote_withdraw(even_state, one_percent_fees, 1_000)
  quote.gross_assets == 1_010 && quote.shares == 1_010 && quote.fee_assets == 10
}

test one_percent_exit_fee_is_subtracted_from_redeem_quote() {
  let quote = math.quote_redeem(even_state, one_percent_fees, 1_000)
  quote.gross_assets == 1_000 && quote.net_assets == 990 && quote.fee_assets == 10
}
