// Full-fill Request settlement prices every entry against the same old State.
// Recovery depends only on the supported recovery envelope, so unsupported
// economic bodies cannot prevent a fixed refund of the escrowed assets.

use aiken/collection/list
use aiken/interval.{Finite, Interval}
use cardano/address.{Script, from_script, from_verification_key}
use cardano/assets
use cardano/transaction.{
  InlineDatum, Input, NoDatum, OutputReference, Spend, Transaction,
}
use ctvs/decode
use ctvs/ledger
use ctvs/math
use ctvs/validation
use ctvs/wire.{
  AcknowledgeBatch, AnySettler, Batch, Cancel, Claim, Datum, DepositExactGross,
  ExpiryRefund, KeyController, KeySet, NativeAsset, RedeemExactShares, Request,
  RequestAction, RequestBody, RequestSpend, SettleEntry, State, StateAction,
  StateSpend, Terms,
}
use ctvs2/family_decode

/// This profile requires finite, lower-inclusive and upper-open intervals.
/// Reject unsupported interval representations instead of guessing a conversion.
pub fn finite_interval(range: Interval) -> (Int, Int) {
  expect Finite(lower) = range.lower_bound.bound_type
  expect Finite(upper) = range.upper_bound.bound_type
  expect range.lower_bound.is_inclusive
  expect !range.upper_bound.is_inclusive
  expect lower < upper
  (lower, upper)
}

fn no_identity(value: assets.Value, policy: ByteArray) -> Bool {
  and {
    assets.quantity_of(value, policy, wire.state_name) == 0,
    assets.quantity_of(value, policy, wire.id_name) == 0,
  }
}

/// Cancellation needs the controller; expiry instead proves the whole validity
/// interval starts at or after the deadline. Both preserve all actual escrowed assets.
fn fixed_refund(
  tx: Transaction,
  own_ref: OutputReference,
  policy: ByteArray,
  datum: Datum,
  refund_index: Int,
  expiry: Bool,
) -> Bool {
  let own = ledger.input(tx, own_ref)
  expect Request { recovery, .. } = datum
  let KeyController { key_hash } = recovery.controller
  let (lower, _) = finite_interval(tx.validity_range)
  let refund = ledger.output(tx, refund_index)
  and {
    validation.valid_request(datum),
    recovery.vault_policy == policy,
    own.output.address == from_script(policy),
    own.output.reference_script == None,
    no_identity(own.output.value, policy),
    ledger.allowed_purposes(tx),
    assets.is_zero(tx.mint),
    list.all(
      tx.inputs,
      fn(input) {
        no_identity(input.output.value, policy) && (
          input.output_reference == own_ref || ledger.key_input(input)
        )
      },
    ),
    if expiry {
      lower >= recovery.deadline_posix_ms
    } else {
      list.has(tx.extra_signatories, key_hash)
    },
    ledger.destination_matches(refund, recovery.refund),
    ledger.contains_value(refund, own.output),
  }
}

/// Dispatch using the Request action before interpreting successful-path economics.
/// Refunds are self-contained. Acknowledgment instead requires the actual consumed
/// State and one matching Batch entry; that State handler proves full settlement,
/// so this branch does not independently quote or validate the Claim payout.
pub fn validate_request(
  tx: Transaction,
  own_ref: OutputReference,
  policy: ByteArray,
  datum: Datum,
  action: RequestAction,
) -> Bool {
  // Branch before downcasting economic_body. Recovery works for unsupported
  // economics while the supported outer/recovery envelope remains intact.
  when action is {
    Cancel { refund_output } ->
      fixed_refund(tx, own_ref, policy, datum, refund_output, False)
    ExpiryRefund { refund_output } ->
      fixed_refund(tx, own_ref, policy, datum, refund_output, True)
    AcknowledgeBatch { state_ref } -> {
      let own = ledger.input(tx, own_ref)
      expect Request { recovery, .. } = datum
      let state_input = ledger.unique_state(tx, policy)
      expect StateSpend { magic, wire_version, action: state_action } = family_decode.state_action_envelope(
        ledger.redeemer(tx, Spend(state_ref)),
      )
      expect Batch { entries, .. } = state_action
      and {
        validation.valid_request(datum),
        recovery.vault_policy == policy,
        own.output.address == from_script(policy),
        own.output.reference_script == None,
        no_identity(own.output.value, policy),
        state_input.output_reference == state_ref,
        own.output.address == state_input.output.address,
        magic == wire.magic,
        wire_version == wire.wire_version,
        list.length(
          list.filter(entries, fn(entry) { entry.request_ref == own_ref }),
        ) == 1,
      }
    }
  }
}

type Totals {
  Totals {
    deposited_gross: Int,
    deposited_net: Int,
    redeemed_gross: Int,
    redeemed_net: Int,
    issued: Int,
    burned: Int,
    fees: Int,
    rewards: Int,
  }
}

const zero_totals =
  Totals {
    deposited_gross: 0,
    deposited_net: 0,
    redeemed_gross: 0,
    redeemed_net: 0,
    issued: 0,
    burned: 0,
    fees: 0,
    rewards: 0,
  }

fn bounded(n: Int) -> Bool {
  n >= 0 && n <= wire.max_q
}

/// Price one Request using the unchanged old State. Totals accumulate obligations,
/// never an intermediate price: changing Request order must not change its quote.
fn accumulate(
  tx: Transaction,
  state_ref: OutputReference,
  old: Datum,
  terms: Terms,
  claim_hash: ByteArray,
  upper: Int,
  entry: SettleEntry,
  totals: Totals,
) -> Totals {
  expect  
      State {
        vault_policy,
        terms_hash,
        backing_assets,
        economic_supply,
        pause_flags,
        ..
      }
    = old
  let source = ledger.input(tx, entry.request_ref)
  expect InlineDatum(raw_request) = source.output.datum
  let request = decode.request(raw_request)
  expect Request { recovery, economic_body, .. } = request
  expect body: RequestBody = economic_body
  // Decode the body once. These are the complete settlement-request predicates;
  // the Boolean convenience validator would perform a second structural decode.
  expect
    validation.valid_request(request) && validation.valid_request_body(body)
  expect validation.normalized_size(request) <= 4096
  expect
    when Pair(body.kind, terms.underlying) is {
      Pair(DepositExactGross, wire.Ada) ->
        validation.q(
          body.offered + body.storage_lovelace + body.execution_budget,
        )
      _ -> True
    }
  expect  
      RequestSpend {
        magic,
        wire_version,
        action: AcknowledgeBatch { state_ref: acknowledged_ref },
      }
    = decode.request_action_envelope(
    ledger.redeemer(tx, Spend(entry.request_ref)),
  )
  expect and {
      source.output.address == from_script(vault_policy),
      source.output.reference_script == None,
      no_identity(source.output.value, vault_policy),
      recovery.vault_policy == vault_policy,
      body.terms_hash == terms_hash,
      upper <= recovery.deadline_posix_ms,
      magic == wire.magic,
      wire_version == wire.wire_version,
      acknowledged_ref == state_ref,
      bounded(entry.claim_topup),
    }
  let share_asset = NativeAsset {
    policy_id: vault_policy,
    asset_name: wire.share_name,
  }
  let (quote, input_asset, result_asset, result_quantity, next) = when
    body.kind
  is {
    DepositExactGross -> {
      expect terms.execution_modes / 4 % 2 == 1 && pause_flags % 2 == 0
      let q = math.quote_deposit(
        backing_assets,
        economic_supply,
        terms,
        body.offered,
      )
      (
        q,
        terms.underlying,
        share_asset,
        q.shares,
        Totals {
          ..totals,
          deposited_gross: totals.deposited_gross + q.gross,
          deposited_net: totals.deposited_net + q.net,
          issued: totals.issued + q.shares,
          fees: totals.fees + q.fee,
          rewards: totals.rewards + body.settler_fee,
        },
      )
    }
    RedeemExactShares -> {
      expect terms.execution_modes / 8 % 2 == 1 && pause_flags / 2 % 2 == 0
      let q = math.quote_redeem(
        backing_assets,
        economic_supply,
        terms,
        body.offered,
      )
      (
        q,
        share_asset,
        terms.underlying,
        q.net,
        Totals {
          ..totals,
          redeemed_gross: totals.redeemed_gross + q.gross,
          redeemed_net: totals.redeemed_net + q.net,
          burned: totals.burned + q.shares,
          fees: totals.fees + q.fee,
          rewards: totals.rewards + body.settler_fee,
        },
      )
    }
  }
  // Unspent execution ADA and external Claim top-ups follow the receiver. They
  // do not increase the offered economic amount or the number of shares issued.
  let carried = body.storage_lovelace + body.execution_budget - body.settler_fee + entry.claim_topup
  let claim_datum = Claim {
    magic: wire.magic,
    wire_version: wire.wire_version,
    vault_policy,
    request_ref: entry.request_ref,
    state_ref,
    terms_hash,
    asset: result_asset,
    economic_quantity: result_quantity,
    receiver: body.receiver,
    carried_lovelace: carried,
  }
  let claim_data: Data = claim_datum
  let claim_output = ledger.output(tx, entry.claim_output)
  expect and {
      quote.gross > 0,
      quote.net > 0,
      quote.shares > 0,
      list.all([quote.gross, quote.net, quote.fee, quote.shares], bounded),
      result_quantity >= body.minimum_output,
      source.output.value == ledger.economic_value(
        input_asset,
        body.offered,
        body.storage_lovelace + body.execution_budget,
      ),
      // Identity, asset, references and receiver have already been validated.
      // Creation only introduces the carried sum and the serialized claim size.
      validation.positive_q(carried),
      validation.normalized_size(claim_datum) <= 2048,
      when result_asset is {
        wire.Ada -> validation.q(result_quantity + carried)
        _ -> True
      },
      claim_output.address == from_script(claim_hash),
      claim_output.datum == InlineDatum(claim_data),
      claim_output.reference_script == None,
      claim_output.value == ledger.economic_value(
        result_asset,
        result_quantity,
        carried,
      ),
    }
  next
}

/// Count every consumed script-P input before economics, while enforcing the
/// closed input domain. Each sorted entry later resolves one such actual input.
fn count_requests(
  inputs: List<Input>,
  policy: ByteArray,
  state_ref: OutputReference,
) -> Int {
  when inputs is {
    [] -> 0
    [input, ..rest] -> {
      expect assets.quantity_of(input.output.value, policy, wire.id_name) == 0
      let belongs = input.output.address.payment_credential == Script(policy)
      expect belongs || ledger.key_input(input)
      let count = count_requests(rest, policy, state_ref)
      if belongs && input.output_reference != state_ref {
        count + 1
      } else {
        count
      }
    }
  }
}

/// Traverse a strictly ordered Request list and reserve each Claim output once.
/// `allocated` begins with State and optional reward indices; `previous` rules out
/// both duplicates and reordered references. Combined with the consumed-Request
/// count, actual input resolution proves exhaustive coverage without a second pass.
fn settle_entries(
  tx: Transaction,
  own_ref: OutputReference,
  old: Datum,
  terms: Terms,
  claim_hash: ByteArray,
  upper: Int,
  entries: List<SettleEntry>,
  previous: Option<OutputReference>,
  allocated: List<Int>,
  totals: Totals,
) -> Totals {
  when entries is {
    [] -> totals
    [entry, ..rest] -> {
      expect validation.valid_out_ref(entry.request_ref)
      expect
        when previous is {
          None -> True
          Some(ref) -> validation.out_ref_before(ref, entry.request_ref)
        }
      expect !list.has(allocated, entry.claim_output)
      let next = accumulate(
        tx,
        own_ref,
        old,
        terms,
        claim_hash,
        upper,
        entry,
        totals,
      )
      settle_entries(
        tx,
        own_ref,
        old,
        terms,
        claim_hash,
        upper,
        rest,
        Some(entry.request_ref),
        [entry.claim_output, ..allocated],
        next,
      )
    }
  }
}

/// Returns the one permissible successor. The State handler authenticates old
/// state/config, checks this successor's closed value and couples nonzero mint.
pub fn validate_batch(
  tx: Transaction,
  own_ref: OutputReference,
  old: Datum,
  terms: Terms,
  action: StateAction,
  claim_hash: ByteArray,
) -> Datum {
  expect  
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
      }
    = old
  expect Batch { state_output, entries, reward_key, reward_output } = action
  let (_, upper) = finite_interval(tx.validity_range)
  let allocated = when reward_output is {
    None -> [state_output]
    Some(index) -> {
      expect index != state_output
      [index, state_output]
    }
  }
  let count = list.length(entries)
  expect and {
      validation.valid_out_ref(own_ref),
      count >= 1,
      count <= terms.max_batch,
      count <= 16,
      count_requests(tx.inputs, vault_policy, own_ref) == count,
      ledger.allowed_purposes(tx),
      list.has(tx.extra_signatories, reward_key),
      when terms.settlers is {
        AnySettler -> True
        KeySet { keys } -> list.has(keys, reward_key)
      },
    }
  let totals = settle_entries(
    tx,
    own_ref,
    old,
    terms,
    claim_hash,
    upper,
    entries,
    None,
    allocated,
    zero_totals,
  )
  expect and {
      list.all(
        [
          totals.deposited_gross,
          totals.deposited_net,
          totals.redeemed_gross,
          totals.redeemed_net,
          totals.issued,
          totals.burned,
          totals.fees,
          totals.rewards,
        ],
        bounded,
      ),
      // Deposits in this Batch cannot fund redemption of shares absent from the
      // old snapshot, even when their issuance offsets the aggregate mint.
      totals.burned <= economic_supply,
      tx.mint == assets.from_asset(
        vault_policy,
        wire.share_name,
        totals.issued - totals.burned,
      ),
      if totals.rewards == 0 {
        reward_output == None
      } else {
        expect Some(index) = reward_output
        let reward = ledger.output(tx, index)
        and {
          reward.address == from_verification_key(reward_key),
          reward.datum == NoDatum,
          reward.reference_script == None,
          reward.value == assets.from_lovelace(assets.lovelace_of(reward.value)),
          assets.lovelace_of(reward.value) >= totals.rewards,
        }
      },
    }
  let next = State {
    magic,
    wire_version,
    vault_policy,
    terms_hash,
    sequence: sequence + 1,
    backing_assets: backing_assets + totals.deposited_net - totals.redeemed_gross,
    economic_supply: economic_supply + totals.issued - totals.burned,
    accrued_fees: accrued_fees + totals.fees,
    storage_lovelace,
    pause_flags,
  }
  expect validation.valid_state(next, terms.underlying)
  expect State { backing_assets: final_backing, .. } = next
  expect
    when terms.max_backing is {
      None -> True
      Some(cap) -> final_backing <= cap
    }
  next
}
