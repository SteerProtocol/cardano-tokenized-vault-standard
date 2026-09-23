// CTVS-WIRE-2 profile 0, whitepaper v0.6.3 Sections 10 and 12.
// Constructor and field order are wire commitments. Economic request bodies
// stay raw until settlement dispatch so recovery remains independent.

use cardano/address.{Address}
use cardano/transaction.{OutputReference}

pub type Asset {
  Ada
  NativeAsset { policy_id: ByteArray, asset_name: ByteArray }
}

/// Fix the whole supported address and datum form, not just a payment key.
/// None requires no output datum; Some requires an equal inline datum.
pub type Destination {
  Destination { address: Address, datum: Option<Data> }
}

/// Cancellation authority only. It need not identify the refund destination or
/// the successful settlement receiver. ExpiryRefund does not require its signature.
pub type Controller {
  KeyController { key_hash: ByteArray }
}

/// AnySettler removes key-list restrictions, not the explicit settler signature.
/// KeySet entries must be sorted, unique 28-byte keys within the profile limit.
pub type Settlers {
  AnySettler
  KeySet { keys: List<ByteArray> }
}

/// Immutable economic and execution configuration committed by the applied script.
/// Type membership alone does not prove valid bounds or supported family modes;
/// those checks live in validation and the selected family handler.
pub type Terms {
  Terms {
    profile: Int,
    // Domain separation supplied for the intended network; not a ledger network-ID lookup.
    network_domain: ByteArray,
    underlying: Asset,
    virtual_shares: Int,
    // Caps priced backing only, excluding fees and storage ADA. None means no configured cap.
    max_backing: Option<Int>,
    entry_bps: Int,
    exit_bps: Int,
    fee_destination: Destination,
    pause_key: Option<ByteArray>,
    settlers: Settlers,
    // Bits 1/2 select direct entry/exit; 4/8 select asynchronous entry/exit.
    execution_modes: Int,
    // A structural ceiling, not a guarantee that this many Requests fit ledger resources.
    max_batch: Int,
    descriptor_hash: Option<ByteArray>,
  }
}

/// The stable refund envelope stays usable even when economic_body is unsupported.
/// Cancellation requires the controller; permissionless expiry uses the lower time
/// bound so the entire transaction validity interval is at or after the deadline.
pub type Recovery {
  Recovery {
    vault_policy: ByteArray,
    controller: Controller,
    refund: Destination,
    deadline_posix_ms: Int,
  }
}

pub type RequestKind {
  DepositExactGross
  RedeemExactShares
}

/// Settlement intent interpreted only by the supported asynchronous family.
/// Offered/minimum quantities change units with kind: assets/shares for deposits,
/// shares/assets for redemptions. All ADA budgets below are separate from pricing.
pub type RequestBody {
  RequestBody {
    terms_hash: ByteArray,
    kind: RequestKind,
    offered: Int,
    minimum_output: Int,
    receiver: Destination,
    storage_lovelace: Int,
    // Settlement carries the unused portion into the Claim; it is not the network fee.
    execution_budget: Int,
    // Deducted from execution_budget and paid to the signed settler reward address.
    settler_fee: Int,
  }
}

pub type Datum {
  State {
    magic: ByteArray,
    wire_version: Int,
    vault_policy: ByteArray,
    terms_hash: ByteArray,
    sequence: Int,
    // Pricing excludes both accrued_fees and storage_lovelace, even for ADA backing.
    backing_assets: Int,
    // Includes issued shares held in funded Claims before their delivery.
    economic_supply: Int,
    accrued_fees: Int,
    storage_lovelace: Int,
    pause_flags: Int,
  }
  Request {
    magic: ByteArray,
    wire_version: Int,
    recovery: Recovery,
    // Deliberately raw Data: decoding the successful path must not gate refunds.
    economic_body: Data,
  }
  Claim {
    magic: ByteArray,
    wire_version: Int,
    vault_policy: ByteArray,
    request_ref: OutputReference,
    state_ref: OutputReference,
    terms_hash: ByteArray,
    asset: Asset,
    economic_quantity: Int,
    receiver: Destination,
    // Travels with the fixed payout; delivery must also preserve any actual surplus.
    carried_lovelace: Int,
  }
  Config {
    magic: ByteArray,
    wire_version: Int,
    vault_policy: ByteArray,
    seed: OutputReference,
    terms_hash: ByteArray,
    terms: Terms,
    storage_lovelace: Int,
  }
}

/// Associate one actual Request input with its distinct funded Claim output.
/// claim_topup is external ADA added by this transaction, not extra offered assets.
pub type SettleEntry {
  SettleEntry {
    request_ref: OutputReference,
    claim_output: Int,
    claim_topup: Int,
  }
}

/// Every consumed Claim gets a separate output index, even for identical receivers.
/// Entries collectively cover all Claims consumed at this delivery script.
pub type DeliverEntry {
  DeliverEntry { claim_ref: OutputReference, receiver_output: Int }
}

/// Actions bind explicit output indices before construction. Direct user bounds
/// are minimum receipts for deposit/redeem and maximum inputs for mint/withdraw;
/// Batch instead applies the minimum stored in each independent Request.
pub type StateAction {
  Deposit {
    receiver: Destination,
    gross_assets: Int,
    min_shares: Int,
    state_output: Int,
    receiver_output: Int,
  }
  MintShares {
    receiver: Destination,
    target_shares: Int,
    max_assets: Int,
    state_output: Int,
    receiver_output: Int,
  }
  Withdraw {
    receiver: Destination,
    net_assets: Int,
    max_shares: Int,
    state_output: Int,
    receiver_output: Int,
  }
  Redeem {
    receiver: Destination,
    shares: Int,
    min_assets: Int,
    state_output: Int,
    receiver_output: Int,
  }
  Batch {
    state_output: Int,
    entries: List<SettleEntry>,
    reward_key: ByteArray,
    reward_output: Option<Int>,
  }
  CollectFees { state_output: Int, fee_output: Int }
  TopUpReserve { additional_lovelace: Int, state_output: Int }
  SetPause { pause_flags: Int, state_output: Int }
}

pub type RequestAction {
  AcknowledgeBatch { state_ref: OutputReference }
  Cancel { refund_output: Int }
  ExpiryRefund { refund_output: Int }
}

pub type ClaimAction {
  Deliver { entries: List<DeliverEntry> }
}

pub type MintAction {
  Initialize { config_output: Int, state_output: Int }
  UpdateSupply { state_ref: OutputReference }
}

/// The outer constructor commits to a script purpose/role in addition to the
/// inner action. A payload valid in one role cannot be reused as another role.
pub type ActionEnvelope {
  StateSpend { magic: ByteArray, wire_version: Int, action: StateAction }
  RequestSpend { magic: ByteArray, wire_version: Int, action: RequestAction }
  ClaimSpend { magic: ByteArray, wire_version: Int, action: ClaimAction }
  MintPurpose { magic: ByteArray, wire_version: Int, action: MintAction }
}

pub const magic = #"43545653"

pub const wire_version = 2

pub const max_q = 9_223_372_036_854_775_807

pub const max_output_index = 65_535

pub const id_name = #"4944"

pub const state_name = #"5354415445"

pub const share_name = #"5348415245"

pub const terms_domain = #"435456532f48322f5445524d5300"
