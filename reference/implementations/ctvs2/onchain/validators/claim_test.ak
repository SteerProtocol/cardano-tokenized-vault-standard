// Claim delivery tests include surplus assets, exact destination datums and
// obligations from multiple vaults. Matching receivers still require separate
// output allocations so one payment cannot satisfy two Claims.

use aiken/collection/list
use cardano/address.{from_script, from_verification_key}
use cardano/assets
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Spend, Transaction,
}
use claim as endpoint
use ctvs/wire.{
  Claim, ClaimSpend, Deliver, DeliverEntry, Destination, NativeAsset,
}
use ctvs2/claim

const q_hash = #"11111111111111111111111111111111111111111111111111111111"

const p_hash = #"22222222222222222222222222222222222222222222222222222222"

const user = #"33333333333333333333333333333333333333333333333333333333"

const terms_hash =
  #"4444444444444444444444444444444444444444444444444444444444444444"

const txid = #"5555555555555555555555555555555555555555555555555555555555555555"

fn ref(index: Int) -> OutputReference {
  OutputReference { transaction_id: txid, output_index: index }
}

fn source(index: Int, policy: ByteArray) -> Input {
  source_to(
    index,
    policy,
    Destination { address: from_verification_key(user), datum: None },
  )
}

fn source_to(index: Int, policy: ByteArray, receiver: Destination) -> Input {
  let record: Data = Claim {
    magic: wire.magic,
    wire_version: wire.wire_version,
    vault_policy: policy,
    request_ref: ref(index + 10),
    state_ref: ref(20),
    terms_hash,
    asset: NativeAsset { policy_id: policy, asset_name: wire.share_name },
    economic_quantity: 10,
    receiver,
    carried_lovelace: 2_000_000,
  }
  Input {
    output_reference: ref(index),
    output: Output {
      address: from_script(q_hash),
      value: assets.from_lovelace(2_100_000)
        |> assets.add(policy, wire.share_name, 10)
        |> assets.add(user, "SURPLUS", 7),
      datum: InlineDatum(record),
      reference_script: None,
    },
  }
}

fn delivered(input: Input) -> Output {
  Output {
    ..input.output,
    address: from_verification_key(user),
    datum: NoDatum,
  }
}

fn delivery(entries: List<DeliverEntry>) -> Data {
  let encoded: Data = ClaimSpend {
    magic: wire.magic,
    wire_version: wire.wire_version,
    action: Deliver { entries },
  }
  encoded
}

fn entries() -> List<DeliverEntry> {
  [
    DeliverEntry { claim_ref: ref(0), receiver_output: 0 },
    DeliverEntry { claim_ref: ref(1), receiver_output: 1 },
  ]
}

fn fixture() -> Transaction {
  let first = source(0, p_hash)
  let second = source(1, user)
  let redeemer = delivery(entries())
  Transaction {
    ..transaction.placeholder,
    inputs: [first, second],
    outputs: [delivered(first), delivered(second)],
    redeemers: [Pair(Spend(ref(0)), redeemer), Pair(Spend(ref(1)), redeemer)],
  }
}

test delivers_all_actual_assets_across_vaults_without_state_or_config() {
  let tx = fixture()
  claim.validate_delivery(tx, ref(0), Deliver { entries: entries() }) && claim.validate_delivery(
    tx,
    ref(1),
    Deliver { entries: entries() },
  )
}

test claim_spend_entrypoint_decodes_exact_role_and_delivers() {
  let tx = fixture()
  expect [first, _] = tx.inputs
  expect InlineDatum(raw) = first.output.datum
  endpoint.claim_guard.spend(Some(raw), delivery(entries()), ref(0), tx)
}

test surplus_native_asset_cannot_be_used_for_submitter_change() {
  let tx = fixture()
  expect [first, second] = tx.outputs
  let reduced = Output {
    ..first,
    value: assets.add(first.value, user, "SURPLUS", -1),
  }
  !claim.validate_delivery(
    Transaction { ..tx, outputs: [reduced, second] },
    ref(0),
    Deliver { entries: entries() },
  )
}

test surplus_lovelace_cannot_pay_delivery_fee() {
  let tx = fixture()
  expect [first, second] = tx.outputs
  let reduced = Output { ..first, value: assets.add(first.value, "", "", -1) }
  !claim.validate_delivery(
    Transaction { ..tx, outputs: [reduced, second] },
    ref(0),
    Deliver { entries: entries() },
  )
}

test same_receiver_still_requires_separate_output_allocations() {
  let entries = [
    DeliverEntry { claim_ref: ref(0), receiver_output: 0 },
    DeliverEntry { claim_ref: ref(1), receiver_output: 0 },
  ]
  !claim.validate_delivery(fixture(), ref(0), Deliver { entries })
}

test omitted_claim_fails_exhaustive_coverage() {
  !claim.validate_delivery(
    fixture(),
    ref(0),
    Deliver {
      entries: [DeliverEntry { claim_ref: ref(0), receiver_output: 0 }],
    },
  )
}

test reverse_order_fails_deterministic_list_rule() {
  !claim.validate_delivery(
    fixture(),
    ref(0),
    Deliver { entries: list.reverse(entries()) },
  )
}

test duplicate_claim_reference_fails() {
  let entries = [
    DeliverEntry { claim_ref: ref(0), receiver_output: 0 },
    DeliverEntry { claim_ref: ref(0), receiver_output: 1 },
  ]
  !claim.validate_delivery(fixture(), ref(0), Deliver { entries })
}

test all_claims_must_use_identical_semantic_delivery_list() {
  let tx = fixture()
  let altered = delivery(
    [DeliverEntry { claim_ref: ref(1), receiver_output: 1 }],
  )
  !claim.validate_delivery(
    Transaction {
      ..tx,
      redeemers: [
        Pair(Spend(ref(0)), delivery(entries())),
        Pair(Spend(ref(1)), altered),
      ],
    },
    ref(0),
    Deliver { entries: entries() },
  )
}

test unrelated_script_input_is_rejected() {
  let tx = fixture()
  let extra = source(2, p_hash)
  let extra = Input {
    ..extra,
    output: Output { ..extra.output, address: from_script(user) },
  }
  !claim.validate_delivery(
    Transaction { ..tx, inputs: [extra, ..tx.inputs] },
    ref(0),
    Deliver { entries: entries() },
  )
}

test delivery_cannot_mint_even_unrelated_assets() {
  let tx = fixture()
  !claim.validate_delivery(
    Transaction { ..tx, mint: assets.from_asset(user, "EXTRA", 1) },
    ref(0),
    Deliver { entries: entries() },
  )
}

test delivery_rejects_zero_withdrawal() {
  let tx = fixture()
  !claim.validate_delivery(
    Transaction {
      ..tx,
      withdrawals: [Pair(from_verification_key(user).payment_credential, 0)],
    },
    ref(0),
    Deliver { entries: entries() },
  )
}

test receiver_datum_must_match_exactly() {
  let tx = fixture()
  expect [first, second] = tx.outputs
  let wrong: Data = 1
  !claim.validate_delivery(
    Transaction {
      ..tx,
      outputs: [Output { ..first, datum: InlineDatum(wrong) }, second],
    },
    ref(0),
    Deliver { entries: entries() },
  )
}

test reference_script_on_delivery_output_is_rejected() {
  let tx = fixture()
  expect [first, second] = tx.outputs
  !claim.validate_delivery(
    Transaction {
      ..tx,
      outputs: [Output { ..first, reference_script: Some(q_hash) }, second],
    },
    ref(0),
    Deliver { entries: entries() },
  )
}

test claim_can_deliver_to_script_with_exact_inline_datum_without_spending_it() {
  let receiver_data: Data = [1, 2, 3]
  let receiver = Destination {
    address: from_script(user),
    datum: Some(receiver_data),
  }
  let source = source_to(0, p_hash, receiver)
  let output = Output {
    ..source.output,
    address: receiver.address,
    datum: InlineDatum(receiver_data),
  }
  let entries = [DeliverEntry { claim_ref: ref(0), receiver_output: 0 }]
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [source],
    outputs: [output],
    redeemers: [Pair(Spend(ref(0)), delivery(entries))],
  }
  claim.validate_delivery(tx, ref(0), Deliver { entries })
}

test externally_funded_delivery_topups_are_permitted() {
  let tx = fixture()
  expect [first, second] = tx.outputs
  let topped_up = Output {
    ..first,
    value: assets.add(first.value, "", "", 1_000_000),
  }
  let funder = Input {
    output_reference: ref(99),
    output: Output {
      address: from_verification_key(user),
      value: assets.from_lovelace(1_000_000),
      datum: NoDatum,
      reference_script: None,
    },
  }
  claim.validate_delivery(
    Transaction {
      ..tx,
      inputs: [funder, ..tx.inputs],
      outputs: [topped_up, second],
    },
    ref(0),
    Deliver { entries: entries() },
  )
}
