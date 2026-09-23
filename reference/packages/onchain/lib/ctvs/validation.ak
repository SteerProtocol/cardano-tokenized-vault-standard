// Wire validity only. Authentication and actual value conservation belong to
// the ledger handlers; a valid record is not evidence of vault provenance.

use aiken/builtin
use aiken/collection/list
use aiken/primitive/bytearray
use cardano/address.{Address, Credential, Inline, Script, VerificationKey}
use cardano/transaction.{OutputReference}
use ctvs/wire.{
  AcknowledgeBatch, Ada, AnySettler, Asset, Batch, Cancel, Claim, ClaimAction,
  CollectFees, Config, Datum, Deliver, DeliverEntry, Deposit, DepositExactGross,
  Destination, ExpiryRefund, Initialize, KeySet, MintAction, MintShares,
  NativeAsset, Recovery, Redeem, Request, RequestAction, RequestBody, SetPause,
  SettleEntry, Settlers, State, StateAction, Terms, TopUpReserve, UpdateSupply,
  Withdraw,
}

pub fn q(n: Int) -> Bool {
  n >= 0 && n <= wire.max_q
}

pub fn positive_q(n: Int) -> Bool {
  n > 0 && n <= wire.max_q
}

pub fn valid_index(n: Int) -> Bool {
  n >= 0 && n <= wire.max_output_index
}

pub fn bytes28(b: ByteArray) -> Bool {
  bytearray.length(b) == 28
}

pub fn bytes32(b: ByteArray) -> Bool {
  bytearray.length(b) == 32
}

pub fn valid_identity(magic: ByteArray, version: Int) -> Bool {
  magic == wire.magic && version == wire.wire_version
}

pub fn valid_out_ref(ref: OutputReference) -> Bool {
  bytes32(ref.transaction_id) && valid_index(ref.output_index)
}

/// Lexicographic transaction bytes, then numeric output index; textual index
/// ordering would place output 10 before output 2 from the same transaction.
pub fn out_ref_before(a: OutputReference, b: OutputReference) -> Bool {
  builtin.less_than_bytearray(a.transaction_id, b.transaction_id) || a.transaction_id == b.transaction_id && a.output_index < b.output_index
}

pub fn valid_asset(asset: Asset) -> Bool {
  when asset is {
    Ada -> True
    NativeAsset { policy_id, asset_name } ->
      bytes28(policy_id) && bytearray.length(asset_name) <= 32
  }
}

fn valid_credential(credential: Credential) -> Bool {
  when credential is {
    VerificationKey(hash) -> bytes28(hash)
    Script(hash) -> bytes28(hash)
  }
}

/// Pointer stake credentials are outside this wire profile; inline stake
/// credentials remain part of the exact destination rather than being discarded.
pub fn valid_address(address: Address) -> Bool {
  valid_credential(address.payment_credential) && when
    address.stake_credential
  is {
    None -> True
    Some(Inline(credential)) -> valid_credential(credential)
    _ -> False
  }
}

/// Traversal spends a node budget before serialisation. Depth starts at zero,
/// matching the candidate reference. A negative remainder denotes rejection.
fn data_budget(data: Data, depth: Int, remaining: Int) -> Int {
  if depth > 16 || remaining <= 0 {
    -1
  } else {
    builtin.choose_data(
      data,
      {
        let Pair(tag, fields) = builtin.un_constr_data(data)
        if tag < 0 || tag > 127 {
          -1
        } else {
          list_budget(fields, depth + 1, remaining - 1)
        }
      },
      map_budget(builtin.un_map_data(data), depth + 1, remaining - 1, []),
      list_budget(builtin.un_list_data(data), depth + 1, remaining - 1),
      {
        let n = builtin.un_i_data(data)
        let bound = 57_896_044_618_658_097_711_785_492_504_343_953_926_634_992_332_820_282_019_728_792_003_956_564_819_968
        if n >= -bound && n < bound {
          remaining - 1
        } else {
          -1
        }
      },
      if bytearray.length(builtin.un_b_data(data)) <= 1024 {
        remaining - 1
      } else {
        -1
      },
    )
  }
}

fn list_budget(items: List<Data>, depth: Int, remaining: Int) -> Int {
  if remaining < 0 {
    -1
  } else {
    when items is {
      [] -> remaining
      [item, ..rest] ->
        list_budget(rest, depth, data_budget(item, depth, remaining))
    }
  }
}

fn map_budget(
  items: Pairs<Data, Data>,
  depth: Int,
  remaining: Int,
  seen: List<Data>,
) -> Int {
  if remaining < 0 {
    -1
  } else {
    when items is {
      [] -> remaining
      [Pair(key, value), ..rest] -> {
        let after_key = data_budget(key, depth, remaining)
        if after_key < 0 || list.has(seen, key) {
          -1
        } else {
          map_budget(
            rest,
            depth,
            data_budget(value, depth, after_key),
            [key, ..seen],
          )
        }
      }
    }
  }
}

/// Restrict opaque destination datums before serializing them for the size check.
/// The shared budget counts containers, keys and values; depth alone would allow
/// very wide values to cause expensive traversal. This is not the general Data
/// limit and must not be imposed on the uninterpreted Request economic_body.
pub fn valid_bounded_data(data: Data) -> Bool {
  data_budget(data, 0, 256) >= 0 && normalized_size(data) <= 1024
}

/// Measure the pinned builtin's serialization, not the original transaction CBOR.
/// Equivalent ledger encodings can have different source lengths; callers bound
/// the semantic shape first when serialization itself needs a resource guard.
pub fn normalized_size(data: Data) -> Int {
  bytearray.length(builtin.serialise_data(data))
}

pub fn valid_destination(destination: Destination) -> Bool {
  valid_address(destination.address) && when destination.datum is {
    None -> True
    Some(data) -> valid_bounded_data(data)
  }
}

fn sorted_keys(keys: List<ByteArray>) -> Bool {
  when keys is {
    [] -> True
    [key] -> bytes28(key)
    [key, next, ..rest] ->
      bytes28(key) && builtin.less_than_bytearray(key, next) && sorted_keys(
        [next, ..rest],
      )
  }
}

pub fn valid_settlers(settlers: Settlers) -> Bool {
  when settlers is {
    AnySettler -> True
    KeySet { keys } -> {
      let size = list.length(keys)
      size >= 1 && size <= 16 && sorted_keys(keys)
    }
  }
}

/// Check the shared capability bitmask only. The selected family must additionally
/// reject unsupported mode combinations; wire validity is not lifecycle suitability.
pub fn valid_terms(terms: Terms) -> Bool {
  terms.profile == 0 && bytes32(terms.network_domain) && valid_asset(
    terms.underlying,
  ) && positive_q(terms.virtual_shares) && when terms.max_backing is {
    None -> True
    Some(cap) -> q(cap)
  } && terms.entry_bps >= 0 && terms.entry_bps < 10_000 && terms.exit_bps >= 0 && terms.exit_bps < 10_000 && valid_destination(
    terms.fee_destination,
  ) && when terms.pause_key is {
    None -> True
    Some(key) -> bytes28(key)
  } && valid_settlers(terms.settlers) && terms.execution_modes >= 1 && terms.execution_modes <= 15 && terms.max_batch >= 1 && terms.max_batch <= 16 && when
    terms.descriptor_hash
  is {
    None -> True
    Some(hash) -> bytes32(hash)
  } && normalized_size(terms) <= 4096
}

/// Call only after valid_terms. Uses the pinned Plutus serialiseData builtin.
pub fn terms_hash(terms: Terms) -> ByteArray {
  builtin.blake2b_256(
    builtin.append_bytearray(wire.terms_domain, builtin.serialise_data(terms)),
  )
}

/// Validate bounded Config fields and recompute the embedded Terms commitment.
/// A matching hash proves consistency, not origin: the identity token, script
/// lock and applied seed/commitment must be checked by the consuming handler.
pub fn valid_config(datum: Datum) -> Bool {
  when datum is {
    Config {
      magic,
      wire_version,
      vault_policy,
      seed,
      terms_hash: commitment,
      terms,
      storage_lovelace,
    } ->
      valid_identity(magic, wire_version) && bytes28(vault_policy) && valid_out_ref(
        seed,
      ) && bytes32(commitment) && valid_terms(terms) && commitment == terms_hash(
        terms,
      ) && positive_q(storage_lovelace) && normalized_size(datum) <= 4608
    _ -> False
  }
}

/// Bound each accounting partition and their combined physical asset quantity.
/// With ADA backing, fees and reserve collide in one lovelace quantity; with
/// native backing, storage ADA is a separate asset. This does not compare a UTxO.
pub fn valid_state(datum: Datum, underlying: Asset) -> Bool {
  when datum is {
    State {
      magic,
      wire_version,
      vault_policy,
      terms_hash,
      sequence,
      backing_assets,
      economic_supply,
      accrued_fees,
      storage_lovelace,
      pause_flags,
    } -> {
      let physical = backing_assets + accrued_fees + when underlying is {
        Ada -> storage_lovelace
        NativeAsset { .. } -> 0
      }
      valid_identity(magic, wire_version) && bytes28(vault_policy) && bytes32(
        terms_hash,
      ) && q(sequence) && q(backing_assets) && q(economic_supply) && q(
        accrued_fees,
      ) && positive_q(storage_lovelace) && q(physical) && pause_flags >= 0 && pause_flags <= 3 && normalized_size(
        datum,
      ) <= 256
    }
    _ -> False
  }
}

pub fn valid_recovery(recovery: Recovery) -> Bool {
  bytes28(recovery.vault_policy) && bytes28(recovery.controller.key_hash) && valid_destination(
    recovery.refund,
  ) && positive_q(recovery.deadline_posix_ms)
}

/// Recovery deliberately does not interpret or serialize economic_body.
pub fn valid_request(datum: Datum) -> Bool {
  when datum is {
    Request { magic, wire_version, recovery, .. } ->
      valid_identity(magic, wire_version) && valid_recovery(recovery)
    _ -> False
  }
}

pub fn valid_request_body(body: RequestBody) -> Bool {
  bytes32(body.terms_hash) && positive_q(body.offered) && positive_q(
    body.minimum_output,
  ) && valid_destination(body.receiver) && positive_q(body.storage_lovelace) && q(
    body.execution_budget,
  ) && q(body.settler_fee) && body.settler_fee <= body.execution_budget && q(
    body.storage_lovelace + body.execution_budget,
  )
}

/// Terms identity, mode and actual-value funding are checked by settlement.
pub fn valid_settlement_request(datum: Datum, underlying: Asset) -> Bool {
  when datum is {
    Request { economic_body, .. } ->
      if economic_body is body: RequestBody {
        valid_request(datum) && valid_request_body(body) && when
          Pair(body.kind, underlying)
        is {
          Pair(DepositExactGross, Ada) ->
            q(body.offered + body.storage_lovelace + body.execution_budget)
          _ -> True
        } && normalized_size(datum) <= 4096
      } else {
        False
      }
    _ -> False
  }
}

/// Check the committed payout fields, bounded destination and normalized size.
/// ADA payouts combine economic_quantity and carried_lovelace physically, so
/// their sum must also fit. Valid fields do not prove a Claim was created by Batch.
pub fn valid_claim(datum: Datum) -> Bool {
  when datum is {
    Claim {
      magic,
      wire_version,
      vault_policy,
      request_ref,
      state_ref,
      terms_hash,
      asset,
      economic_quantity,
      receiver,
      carried_lovelace,
    } ->
      valid_identity(magic, wire_version) && bytes28(vault_policy) && valid_out_ref(
        request_ref,
      ) && valid_out_ref(state_ref) && bytes32(terms_hash) && valid_asset(asset) && positive_q(
        economic_quantity,
      ) && valid_destination(receiver) && positive_q(carried_lovelace) && when
        asset
      is {
        Ada -> q(economic_quantity + carried_lovelace)
        NativeAsset { .. } -> True
      } && normalized_size(datum) <= 2048
    _ -> False
  }
}

fn valid_settle_entries(entries: List<SettleEntry>) -> Bool {
  when entries is {
    [] -> True
    [entry, ..rest] ->
      valid_out_ref(entry.request_ref) && valid_index(entry.claim_output) && q(
        entry.claim_topup,
      ) && when rest is {
        [] -> True
        [next, ..] -> out_ref_before(entry.request_ref, next.request_ref)
      } && valid_settle_entries(rest)
  }
}

fn valid_deliver_entries(entries: List<DeliverEntry>) -> Bool {
  when entries is {
    [] -> True
    [entry, ..rest] ->
      valid_out_ref(entry.claim_ref) && valid_index(entry.receiver_output) && when
        rest
      is {
        [] -> True
        [next, ..] -> out_ref_before(entry.claim_ref, next.claim_ref)
      } && valid_deliver_entries(rest)
  }
}

fn valid_direct(
  receiver: Destination,
  amount: Int,
  bound: Int,
  state_output: Int,
  receiver_output: Int,
) -> Bool {
  valid_destination(receiver) && positive_q(amount) && positive_q(bound) && valid_index(
    state_output,
  ) && valid_index(receiver_output) && state_output != receiver_output
}

pub fn valid_state_action(action: StateAction) -> Bool {
  when action is {
    Deposit {
      receiver,
      gross_assets,
      min_shares,
      state_output,
      receiver_output,
    } ->
      valid_direct(
        receiver,
        gross_assets,
        min_shares,
        state_output,
        receiver_output,
      )
    MintShares {
      receiver,
      target_shares,
      max_assets,
      state_output,
      receiver_output,
    } ->
      valid_direct(
        receiver,
        target_shares,
        max_assets,
        state_output,
        receiver_output,
      )
    Withdraw { receiver, net_assets, max_shares, state_output, receiver_output } ->
      valid_direct(
        receiver,
        net_assets,
        max_shares,
        state_output,
        receiver_output,
      )
    Redeem { receiver, shares, min_assets, state_output, receiver_output } ->
      valid_direct(receiver, shares, min_assets, state_output, receiver_output)
    Batch { state_output, entries, reward_key, reward_output } -> {
      let size = list.length(entries)
      valid_index(state_output) && bytes28(reward_key) && size >= 1 && size <= 16 && valid_settle_entries(
        entries,
      ) && when reward_output is {
        None -> True
        Some(index) -> valid_index(index)
      }
    }
    CollectFees { state_output, fee_output } ->
      valid_index(state_output) && valid_index(fee_output) && state_output != fee_output
    TopUpReserve { additional_lovelace, state_output } ->
      positive_q(additional_lovelace) && valid_index(state_output)
    SetPause { pause_flags, state_output } ->
      pause_flags >= 0 && pause_flags <= 3 && valid_index(state_output)
  }
}

pub fn valid_request_action(action: RequestAction) -> Bool {
  when action is {
    AcknowledgeBatch { state_ref } -> valid_out_ref(state_ref)
    Cancel { refund_output } -> valid_index(refund_output)
    ExpiryRefund { refund_output } -> valid_index(refund_output)
  }
}

pub fn valid_claim_action(action: ClaimAction) -> Bool {
  let Deliver { entries } = action
  let size = list.length(entries)
  size >= 1 && size <= 16 && valid_deliver_entries(entries)
}

pub fn valid_mint_action(action: MintAction) -> Bool {
  when action is {
    Initialize { config_output, state_output } ->
      valid_index(config_output) && valid_index(state_output) && config_output != state_output
    UpdateSupply { state_ref } -> valid_out_ref(state_ref)
  }
}
