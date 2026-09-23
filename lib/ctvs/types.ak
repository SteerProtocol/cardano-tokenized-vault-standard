/// Small, wire-independent types used only by the economic math kernel and
/// its unit tests. The actual CTVS v0 datum and redeemer schema is in
/// `ctvs/wire.ak`; do not serialize these planning fixtures on-chain.

/// A convenient identity for fixtures. It deliberately does not model ADA.
/// `ctvs/wire.AssetId` is the authoritative production-facing type.
pub type AssetId {
  AssetId {
    policy_id: ByteArray,
    asset_name: ByteArray,
  }
}

/// Rates only. The full CTVS-1 fee configuration also contains an immutable
/// payout `OutputDestination` and is defined in `ctvs/wire.ak`.
pub type FeeConfig {
  FeeConfig {
    entry_fee_bps: Int,
    exit_fee_bps: Int,
  }
}

pub type VaultStatus {
  Open
  DepositsPaused
  RedemptionsPaused
  Paused
}

/// The math kernel sees only share-backed assets. A deployed CTVS state also
/// contains accrued fees and a storage-lovelace reserve, neither of which
/// belongs in conversion math.
pub type VaultState {
  VaultState {
    version: Int,
    vault_id: AssetId,
    underlying: AssetId,
    share: AssetId,
    total_assets: Int,
    total_shares: Int,
    virtual_assets: Int,
    virtual_shares: Int,
    accounting_epoch: Int,
    status: VaultStatus,
  }
}

/// A uniform result for all four action-specific preview functions.
///
/// Deposit and mint: `gross_assets` is paid by the user, `net_assets` backs
/// newly minted shares, and `fee_assets` becomes an accrued recipient
/// liability. Withdraw and redeem: `gross_assets` is removed from share
/// backing, `net_assets` goes to the user, and `fee_assets` becomes an accrued
/// recipient liability.
pub type Quote {
  Quote {
    gross_assets: Int,
    net_assets: Int,
    fee_assets: Int,
    shares: Int,
  }
}
