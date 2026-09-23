/// CTVS v0 proposed on-chain wire format.
///
/// These types are the source for the eventual CIP-57 blueprint. Constructor
/// order and field order are compatibility commitments. Do not reorder or
/// insert fields into an already-published version. Create a new versioned
/// type instead.
use aiken/crypto.{VerificationKeyHash}
use cardano/address.{Address}
use cardano/transaction.{OutputReference}

/// ADA is explicit rather than represented by empty policy and asset-name
/// byte strings. The value adapter maps `Ada` to the ledger's ADA entry.
pub type AssetId {
  Ada
  NativeAsset {
    policy_id: ByteArray,
    asset_name: ByteArray,
  }
}

pub type VaultStatus {
  Open
  DepositsPaused
  RedemptionsPaused
  Paused
}

/// CTVS specifies the authority's narrowly scoped powers, not the governance
/// system that owns a key or capability UTxO.
pub type PauseAuthority {
  NoPauseAuthority
  PauseKey { key_hash: VerificationKeyHash }
  PauseCapability {
    address: Address,
    token: AssetId,
  }
}

/// A destination fixes both the payment address and, when needed, the inline
/// datum that a receiving script expects. `None` means the output has no
/// datum; `Some` means the output carries exactly that datum inline. CTVS v0
/// deliberately does not support datum-hash-only destinations.
pub type OutputDestination {
  OutputDestination {
    address: Address,
    inline_datum: Option<Data>,
  }
}

/// Fees are always configured in CTVS-1. A zero rate disables the associated
/// charge, while retaining a stable recipient and collection interface.
pub type FeeConfig {
  FeeConfig {
    entry_fee_bps: Int,
    exit_fee_bps: Int,
    payout: OutputDestination,
  }
}

/// All fields are immutable after the factory transition. This datum is held
/// by an authenticated config UTxO and supplied as a reference input to every
/// state transition and fee collection.
pub type VaultConfigV0 {
  VaultConfigV0 {
    format_version: Int,
    vault_id: AssetId,
    state_token: AssetId,
    underlying: AssetId,
    share: AssetId,
    virtual_assets: Int,
    virtual_shares: Int,
    max_total_assets: Option<Int>,
    fees: FeeConfig,
    pause_authority: PauseAuthority,
    config_storage_lovelace: Int,
    reserve_return: OutputDestination,
  }
}

/// `total_assets` is the amount backing shares. It deliberately excludes
/// charged but uncollected fees and the ADA required to keep the state output
/// valid. See docs/08-authority-ada-fees-and-wire-format.md for value rules.
pub type VaultStateV0 {
  VaultStateV0 {
    format_version: Int,
    vault_id: AssetId,
    total_assets: Int,
    accrued_fee_assets: Int,
    total_shares: Int,
    state_storage_lovelace: Int,
    accounting_epoch: Int,
    status: VaultStatus,
  }
}

pub type DirectAction {
  Deposit {
    receiver: OutputDestination,
    gross_assets: Int,
    min_shares: Int,
  }
  Mint {
    receiver: OutputDestination,
    target_shares: Int,
    max_assets: Int,
  }
  Withdraw {
    receiver: OutputDestination,
    net_assets: Int,
    max_shares: Int,
  }
  Redeem {
    receiver: OutputDestination,
    shares: Int,
    min_assets: Int,
  }
  ClaimFees
  Pause
  Resume
  TopUpStateReserve { additional_lovelace: Int }
}

/// CTVS-2 is not a CTVS-1 dependency. It is included here as the proposed
/// identity-safe extension so that later work cannot depend on output order.
pub type RequestKind {
  DepositRequest {
    gross_assets: Int,
    min_shares: Int,
  }
  RedeemRequest {
    shares: Int,
    min_assets: Int,
  }
}

pub type RequestDatumV0 {
  RequestDatumV0 {
    format_version: Int,
    vault_id: AssetId,
    owner: VerificationKeyHash,
    receiver: OutputDestination,
    refund_destination: OutputDestination,
    kind: RequestKind,
    deadline_posix_ms: Int,
    request_storage_lovelace: Int,
    settler_reward_lovelace: Int,
  }
}

pub type ClaimKind {
  ShareClaim
  AssetClaim
}

pub type ClaimDatumV0 {
  ClaimDatumV0 {
    format_version: Int,
    request_id: OutputReference,
    vault_id: AssetId,
    owner: VerificationKeyHash,
    receiver: OutputDestination,
    kind: ClaimKind,
    claim_quantity: Int,
    refund_lovelace: Int,
  }
}
