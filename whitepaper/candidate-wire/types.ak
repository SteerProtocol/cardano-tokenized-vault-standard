// Candidate CTVS-WIRE-2 type declarations only. NOT COMPILED in this package.
// Field order mirrors schema.json. All semantic bounds, role authentication,
// version literals and cross-field relations still require explicit validation.
// Never deploy a script merely because these types compile.
use cardano/address.{Address}
use cardano/transaction.{OutputReference}

pub type Asset {
  Ada
  Native { policy: ByteArray, name: ByteArray }
}
pub type Destination {
  Destination { address: Address, inline_datum: Option<Data> }
}
pub type KeyController {
  KeyController { key_hash: ByteArray }
}
pub type SettlerPolicy {
  OpenAnySigningKey
  KeySet { key_hashes: List<ByteArray> }
}
pub type Terms {
  Terms {
    profile: Int,
    network_domain: ByteArray,
    underlying: Asset,
    virtual_shares: Int,
    max_backing: Option<Int>,
    entry_bps: Int,
    exit_bps: Int,
    fee_destination: Destination,
    pause_key: Option<ByteArray>,
    settlers: SettlerPolicy,
    execution_modes: Int,
    max_batch: Int,
    descriptor_hash: Option<ByteArray>,
  }
}
pub type Recovery {
  Recovery {
    vault_policy: ByteArray,
    controller: KeyController,
    refund: Destination,
    deadline_posix_ms: Int,
  }
}
pub type RequestKind {
  DepositExactGross
  RedeemExactShares
}
pub type RequestBody {
  RequestBody {
    terms_hash: ByteArray,
    kind: RequestKind,
    offered: Int,
    minimum_output: Int,
    receiver: Destination,
    storage_lovelace: Int,
    execution_budget: Int,
    settler_fee: Int,
  }
}
pub type VaultDatum {
  State {
    magic: ByteArray,
    wire_version: Int,
    vault_policy: ByteArray,
    terms_hash: ByteArray,
    sequence: Int,
    backing_assets: Int,
    economic_supply: Int,
    accrued_fees: Int,
    storage_lovelace: Int,
    pause_flags: Int,
  }
  Request {
    magic: ByteArray,
    wire_version: Int,
    recovery: Recovery,
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
pub type SettleEntry {
  SettleEntry {
    request_ref: OutputReference,
    claim_output: Int,
    claim_topup: Int,
  }
}
pub type DeliverEntry {
  DeliverEntry { claim_ref: OutputReference, receiver_output: Int }
}
pub type StateAction {
  Deposit { receiver: Destination, gross_assets: Int, min_shares: Int, state_output: Int, receiver_output: Int }
  MintShares { receiver: Destination, target_shares: Int, max_assets: Int, state_output: Int, receiver_output: Int }
  Withdraw { receiver: Destination, net_assets: Int, max_shares: Int, state_output: Int, receiver_output: Int }
  Redeem { receiver: Destination, shares: Int, min_assets: Int, state_output: Int, receiver_output: Int }
  Batch { state_output: Int, entries: List<SettleEntry>, reward_key: ByteArray, reward_output: Option<Int> }
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
pub type ActionEnvelope {
  StateSpend { magic: ByteArray, wire_version: Int, action: StateAction }
  RequestSpend { magic: ByteArray, wire_version: Int, action: RequestAction }
  ClaimSpend { magic: ByteArray, wire_version: Int, action: ClaimAction }
  MintPurpose { magic: ByteArray, wire_version: Int, action: MintAction }
}
