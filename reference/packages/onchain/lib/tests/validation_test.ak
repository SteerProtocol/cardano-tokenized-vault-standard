// Adversarial wire and bounded-data checks shared by both family suites.
// Exact shapes, normalized sizes and opaque recovery bodies are tested without
// treating a structurally valid datum as an authenticated onchain vault.

use aiken/builtin
use aiken/collection/list
use cardano/address.{Address, Inline, Pointer, Script, VerificationKey}
use cardano/transaction.{OutputReference}
use ctvs/decode
use ctvs/validation
use ctvs/wire.{
  Ada, AnySettler, Claim, ClaimSpend, Config, Datum, Deliver, DeliverEntry,
  Deposit, DepositExactGross, Destination, KeyController, KeySet, MintPurpose,
  NativeAsset, Recovery, Request, RequestBody, RequestSpend, State, StateSpend,
  Terms, UpdateSupply,
}

const key = #"11111111111111111111111111111111111111111111111111111111"

const policy = #"22222222222222222222222222222222222222222222222222222222"

const hash = #"3333333333333333333333333333333333333333333333333333333333333333"

const dest =
  Destination {
    address: Address {
      payment_credential: VerificationKey(key),
      stake_credential: None,
    },
    datum: None,
  }

const terms =
  Terms {
    profile: 0,
    network_domain: hash,
    underlying: Ada,
    virtual_shares: 1,
    max_backing: None,
    entry_bps: 100,
    exit_bps: 100,
    fee_destination: dest,
    pause_key: Some(key),
    settlers: AnySettler,
    execution_modes: 15,
    max_batch: 16,
    descriptor_hash: None,
  }

const ref = OutputReference { transaction_id: hash, output_index: 0 }

const recovery =
  Recovery {
    vault_policy: policy,
    controller: KeyController { key_hash: key },
    refund: dest,
    deadline_posix_ms: 1_000,
  }

const request_body =
  RequestBody {
    terms_hash: hash,
    kind: DepositExactGross,
    offered: 100,
    minimum_output: 99,
    receiver: dest,
    storage_lovelace: 20,
    execution_budget: 10,
    settler_fee: 5,
  }

fn state(backing: Int, fees: Int, reserve: Int) -> Datum {
  State {
    magic: wire.magic,
    wire_version: wire.wire_version,
    vault_policy: policy,
    terms_hash: hash,
    sequence: 0,
    backing_assets: backing,
    economic_supply: 100,
    accrued_fees: fees,
    storage_lovelace: reserve,
    pause_flags: 0,
  }
}

fn nested(depth: Int, leaf: Data) -> Data {
  if depth <= 0 {
    leaf
  } else {
    builtin.constr_data(0, [nested(depth - 1, leaf)])
  }
}

fn outer_request(body: Data) -> Datum {
  Request {
    magic: wire.magic,
    wire_version: wire.wire_version,
    recovery,
    economic_body: body,
  }
}

test quantity_bounds_are_exact() {
  validation.q(0) && validation.q(wire.max_q) && !validation.q(-1) && !validation.q(
    wire.max_q + 1,
  ) && !validation.positive_q(0) && validation.positive_q(1)
}

test valid_terms_and_config_commitment() {
  let config = Config {
    magic: wire.magic,
    wire_version: 2,
    vault_policy: policy,
    seed: ref,
    terms_hash: validation.terms_hash(terms),
    terms,
    storage_lovelace: 2_000_000,
  }
  validation.valid_terms(terms) && validation.valid_config(config)
}

test wrong_config_commitment_is_rejected() {
  let config = Config {
    magic: wire.magic,
    wire_version: 2,
    vault_policy: policy,
    seed: ref,
    terms_hash: hash,
    terms,
    storage_lovelace: 2_000_000,
  }
  !validation.valid_config(config)
}

test terms_reject_unknown_modes_profiles_and_invalid_cap() {
  !validation.valid_terms(Terms { ..terms, execution_modes: 16 }) && !validation.valid_terms(
    Terms { ..terms, profile: 1 },
  ) && !validation.valid_terms(Terms { ..terms, max_backing: Some(-1) }) && !validation.valid_terms(
    Terms { ..terms, entry_bps: 10_000 },
  )
}

test key_sets_are_bounded_sorted_and_unique() {
  validation.valid_settlers(KeySet { keys: [key, policy] }) && !validation.valid_settlers(
    KeySet { keys: [policy, key] },
  ) && !validation.valid_settlers(KeySet { keys: [key, key] }) && !validation.valid_settlers(
    KeySet { keys: [] },
  )
}

test state_checks_physical_sum_for_each_underlying() {
  validation.valid_state(state(wire.max_q - 1, 0, 1), Ada) && !validation.valid_state(
    state(wire.max_q, 0, 1),
    Ada,
  ) && validation.valid_state(
    state(wire.max_q, 0, 1),
    NativeAsset { policy_id: policy, asset_name: #"00" },
  ) && !validation.valid_state(
    state(wire.max_q, 1, 1),
    NativeAsset { policy_id: policy, asset_name: #"00" },
  ) && !validation.valid_state(state(1, 0, 0), Ada)
}

test addresses_reject_pointer_and_short_credentials() {
  validation.valid_destination(dest) && validation.valid_destination(
    Destination {
      ..dest,
      address: Address {
        payment_credential: Script(policy),
        stake_credential: Some(Inline(VerificationKey(key))),
      },
    },
  ) && !validation.valid_destination(
    Destination {
      ..dest,
      address: Address {
        payment_credential: VerificationKey(key),
        stake_credential: Some(
          Pointer { slot_number: 1, transaction_index: 0, certificate_index: 0 },
        ),
      },
    },
  ) && !validation.valid_destination(
    Destination {
      ..dest,
      address: Address {
        payment_credential: VerificationKey(#"11"),
        stake_credential: None,
      },
    },
  )
}

test opaque_depth_bound_counts_root_as_zero() {
  validation.valid_bounded_data(nested(16, builtin.i_data(0))) && !validation.valid_bounded_data(
    nested(17, builtin.i_data(0)),
  )
}

test opaque_node_limit_includes_container() {
  validation.valid_bounded_data(
    builtin.list_data(list.repeat(builtin.i_data(0), 255)),
  ) && !validation.valid_bounded_data(
    builtin.list_data(list.repeat(builtin.i_data(0), 256)),
  )
}

test opaque_constructor_tags_are_bounded() {
  validation.valid_bounded_data(builtin.constr_data(127, [])) && !validation.valid_bounded_data(
    builtin.constr_data(128, []),
  )
}

test opaque_integer_bounds_are_signed_256_bits() {
  let bound = 57_896_044_618_658_097_711_785_492_504_343_953_926_634_992_332_820_282_019_728_792_003_956_564_819_968
  validation.valid_bounded_data(builtin.i_data(-bound)) && validation.valid_bounded_data(
    builtin.i_data(bound - 1),
  ) && !validation.valid_bounded_data(builtin.i_data(-bound - 1)) && !validation.valid_bounded_data(
    builtin.i_data(bound),
  )
}

test opaque_maps_preserve_pairs_and_reject_duplicate_equal_keys() {
  let one = builtin.i_data(1)
  let two = builtin.i_data(2)
  let unique = builtin.map_data([Pair(two, one), Pair(one, two)])
  let duplicate = builtin.map_data([Pair(one, two), Pair(one, one)])
  validation.valid_bounded_data(unique) && !validation.valid_bounded_data(
    duplicate,
  )
}

test opaque_normalized_size_counts_cbor_overhead() {
  let bytes = builtin.b_data(builtin.replicate_byte(1024, 0))
  !validation.valid_bounded_data(bytes) && validation.valid_bounded_data(
    builtin.b_data(builtin.replicate_byte(960, 0)),
  )
}

test recovery_ignores_unsupported_and_oversized_economics() {
  let unsupported = outer_request(builtin.constr_data(99, []))
  let oversized = outer_request(builtin.b_data(builtin.replicate_byte(5000, 0)))
  validation.valid_request(unsupported) && validation.valid_request(oversized) && !validation.valid_settlement_request(
    unsupported,
    Ada,
  ) && !validation.valid_settlement_request(oversized, Ada)
}

test malformed_recovery_is_not_rescuable_by_supported_outer_version() {
  let request = Request {
    magic: wire.magic,
    wire_version: 2,
    recovery: Recovery { ..recovery, deadline_posix_ms: 0 },
    economic_body: builtin.i_data(0),
  }
  !validation.valid_request(request)
}

test request_funding_aggregate_and_fee_bounds() {
  validation.valid_settlement_request(outer_request(request_body), Ada) && !validation.valid_request_body(
    RequestBody { ..request_body, settler_fee: 11 },
  ) && !validation.valid_request_body(
    RequestBody { ..request_body, offered: 0 },
  ) && !validation.valid_request_body(
    RequestBody { ..request_body, minimum_output: 0 },
  ) && !validation.valid_settlement_request(
    outer_request(RequestBody { ..request_body, offered: wire.max_q }),
    Ada,
  )
}

test claim_ada_aggregate_bound() {
  let claim = Claim {
    magic: wire.magic,
    wire_version: 2,
    vault_policy: policy,
    request_ref: ref,
    state_ref: ref,
    terms_hash: hash,
    asset: Ada,
    economic_quantity: wire.max_q,
    receiver: dest,
    carried_lovelace: 1,
  }
  !validation.valid_claim(claim)
}

test decoder_rejects_extra_and_missing_state_fields() {
  let raw: Data = state(100, 0, 1)
  let Pair(tag, fields) = builtin.un_constr_data(raw)
  let extra = builtin.constr_data(tag, list.concat(fields, [builtin.i_data(0)]))
  let missing = builtin.constr_data(tag, list.take(fields, 9))
  let accepts_extra = if extra is _: Datum {
    True
  } else {
    False
  }
  let accepts_missing = if missing is _: Datum {
    True
  } else {
    False
  }
  !accepts_extra && !accepts_missing
}

test decoder_keeps_recovery_body_raw() {
  let raw: Data = outer_request(builtin.constr_data(99, [builtin.i_data(-1)]))
  if raw is decoded: Datum {
    validation.valid_request(decoded)
  } else {
    False
  }
}

test envelope_role_and_arity_are_distinct() {
  let mint: Data = MintPurpose {
    magic: wire.magic,
    wire_version: 2,
    action: UpdateSupply { state_ref: ref },
  }
  if mint is decoded: wire.ActionEnvelope {
    when decoded is {
      StateSpend { .. } -> False
      RequestSpend { .. } -> False
      ClaimSpend { .. } -> False
      MintPurpose { .. } -> True
    }
  } else {
    False
  }
}

test delivery_lists_require_sorted_unique_references() {
  let entry = DeliverEntry { claim_ref: ref, receiver_output: 0 }
  let later = DeliverEntry {
    claim_ref: OutputReference { ..ref, output_index: 1 },
    receiver_output: 1,
  }
  validation.valid_claim_action(Deliver { entries: [entry, later] }) && !validation.valid_claim_action(
    Deliver { entries: [entry, entry] },
  ) && !validation.valid_claim_action(Deliver { entries: [later, entry] }) && !validation.valid_claim_action(
    Deliver { entries: [] },
  )
}

test direct_actions_reject_shared_successor_and_receiver_output() {
  !validation.valid_state_action(
    Deposit {
      receiver: dest,
      gross_assets: 100,
      min_shares: 1,
      state_output: 0,
      receiver_output: 0,
    },
  )
}

test decoder_rejects_nested_wrong_credential_type_and_arity() {
  let wrong_key = builtin.constr_data(0, [builtin.i_data(28)])
  let extra_credential = builtin.constr_data(
    0,
    [builtin.b_data(key), builtin.i_data(0)],
  )
  let no_stake = builtin.constr_data(1, [])
  let no_datum = builtin.constr_data(1, [])
  let invalid_type = builtin.constr_data(
    0,
    [builtin.constr_data(0, [wrong_key, no_stake]), no_datum],
  )
  let invalid_arity = builtin.constr_data(
    0,
    [builtin.constr_data(0, [extra_credential, no_stake]), no_datum],
  )
  let accepts_type = if invalid_type is _: Destination {
    True
  } else {
    False
  }
  let accepts_arity = if invalid_arity is _: Destination {
    True
  } else {
    False
  }
  !accepts_type && !accepts_arity
}

test decoder_rejects_malformed_envelope_and_unknown_action_tag() {
  let update: Data = UpdateSupply { state_ref: ref }
  let extra = builtin.constr_data(
    3,
    [builtin.b_data(wire.magic), builtin.i_data(2), update, builtin.i_data(0)],
  )
  let unknown = builtin.constr_data(
    3,
    [builtin.b_data(wire.magic), builtin.i_data(2), builtin.constr_data(99, [])],
  )
  let accepts_extra = if extra is _: wire.ActionEnvelope {
    True
  } else {
    False
  }
  let accepts_unknown = if unknown is _: wire.ActionEnvelope {
    True
  } else {
    False
  }
  !accepts_extra && !accepts_unknown
}

test recovery_rejects_unknown_outer_version_without_touching_economics() {
  let request = Request {
    magic: wire.magic,
    wire_version: 3,
    recovery,
    economic_body: builtin.b_data(builtin.replicate_byte(5000, 0)),
  }
  !validation.valid_request(request)
}

/// The expected bytes and commitment are independently emitted by the JavaScript
/// client fixture writer, then compared here with the pinned Plutus builtin.
test terms_builtin_serialization_and_hash_match_client_fixture() {
  let sample_destination = Destination {
    address: Address {
      payment_credential: VerificationKey(policy),
      stake_credential: None,
    },
    datum: None,
  }
  let sample = Terms {
    ..terms,
    underlying: NativeAsset {
      policy_id: #"44444444444444444444444444444444444444444444444444444444",
      asset_name: #"554e4954",
    },
    fee_destination: sample_destination,
    pause_key: Some(policy),
  }
  let expected = #"d8799f0058203333333333333333333333333333333333333333333333333333333333333333d87a9f581c4444444444444444444444444444444444444444444444444444444444554e4954ff01d87a8018641864d8799fd8799fd8799f581c22222222222222222222222222222222222222222222222222222222ffd87a80ffd87a80ffd8799f581c22222222222222222222222222222222222222222222222222222222ffd879800f10d87a80ff"
  validation.valid_terms(sample) && builtin.serialise_data(sample) == expected && validation.terms_hash(
    sample,
  ) == #"3e786871c31d0ba1684920693cbb3ae53e42eca96d272280bf732e44b8844220"
}

test scoped_decoders_preserve_all_public_datum_tags_and_fields() {
  let s = state(100, 0, 1)
  let c = Config {
    magic: wire.magic,
    wire_version: 2,
    vault_policy: policy,
    seed: ref,
    terms_hash: validation.terms_hash(terms),
    terms,
    storage_lovelace: 2_000_000,
  }
  let r = outer_request(
    builtin.constr_data(99, [builtin.b_data(builtin.replicate_byte(5000, 0))]),
  )
  let claim = Claim {
    magic: wire.magic,
    wire_version: 2,
    vault_policy: policy,
    request_ref: ref,
    state_ref: ref,
    terms_hash: hash,
    asset: Ada,
    economic_quantity: 1,
    receiver: dest,
    carried_lovelace: 1,
  }
  decode.state(s) == s && decode.config(c) == c && decode.request(r) == r && decode.claim(
    claim,
  ) == claim && validation.valid_request(decode.request(r))
}

test scoped_envelope_decoders_preserve_role_and_actions() {
  let s = StateSpend {
    magic: wire.magic,
    wire_version: 2,
    action: Deposit {
      receiver: dest,
      gross_assets: 100,
      min_shares: 99,
      state_output: 0,
      receiver_output: 1,
    },
  }
  let r = RequestSpend {
    magic: wire.magic,
    wire_version: 2,
    action: wire.Cancel { refund_output: 1 },
  }
  let c = ClaimSpend {
    magic: wire.magic,
    wire_version: 2,
    action: Deliver {
      entries: [DeliverEntry { claim_ref: ref, receiver_output: 0 }],
    },
  }
  let m = MintPurpose {
    magic: wire.magic,
    wire_version: 2,
    action: UpdateSupply { state_ref: ref },
  }
  decode.state_action_envelope(s) == s && decode.request_action_envelope(r) == r && decode.claim_action_envelope(
    c,
  ) == c && decode.mint_action_envelope(m) == m
}

test scoped_state_decoder_rejects_extra_field() fail {
  let raw: Data = state(100, 0, 1)
  let Pair(tag, fields) = builtin.un_constr_data(raw)
  expect _ = decode.state(
    builtin.constr_data(tag, list.concat(fields, [builtin.i_data(0)])),
  )
  True
}

test scoped_state_decoder_rejects_missing_field() fail {
  let raw: Data = state(100, 0, 1)
  let Pair(tag, fields) = builtin.un_constr_data(raw)
  expect _ = decode.state(builtin.constr_data(tag, list.take(fields, 9)))
  True
}

test scoped_state_decoder_rejects_wrong_role() fail {
  expect _ = decode.state(outer_request(builtin.i_data(0)))
  True
}

test scoped_request_decoder_rejects_malformed_recovery_controller() fail {
  let raw_destination: Data = dest
  let invalid_recovery = builtin.constr_data(
    0,
    [
      builtin.b_data(policy),
      builtin.constr_data(0, [builtin.i_data(28)]),
      raw_destination,
      builtin.i_data(1_000),
    ],
  )
  let raw = builtin.constr_data(
    1,
    [
      builtin.b_data(wire.magic),
      builtin.i_data(2),
      invalid_recovery,
      builtin.constr_data(99, []),
    ],
  )
  expect _ = decode.request(raw)
  True
}

test scoped_config_decoder_rejects_extra_nested_terms_field() fail {
  let raw_ref: Data = ref
  let raw_terms: Data = terms
  let Pair(_, fields) = builtin.un_constr_data(raw_terms)
  let malformed_terms = builtin.constr_data(
    0,
    list.concat(fields, [builtin.i_data(0)]),
  )
  let raw = builtin.constr_data(
    3,
    [
      builtin.b_data(wire.magic),
      builtin.i_data(2),
      builtin.b_data(policy),
      raw_ref,
      builtin.b_data(hash),
      malformed_terms,
      builtin.i_data(2_000_000),
    ],
  )
  expect _ = decode.config(raw)
  True
}

test scoped_envelope_rejects_another_role() fail {
  let raw = RequestSpend {
    magic: wire.magic,
    wire_version: 2,
    action: wire.Cancel { refund_output: 1 },
  }
  expect _ = decode.state_action_envelope(raw)
  True
}

test scoped_envelope_rejects_extra_inner_action_field() fail {
  let raw = builtin.constr_data(
    1,
    [
      builtin.b_data(wire.magic),
      builtin.i_data(2),
      builtin.constr_data(1, [builtin.i_data(0), builtin.i_data(0)]),
    ],
  )
  expect _ = decode.request_action_envelope(raw)
  True
}

test scoped_decoder_rejects_non_constructor_data() fail {
  expect _ = decode.state(builtin.list_data([]))
  True
}

// Client recovery must preserve these valid raw Data bodies even though neither
// is a supported settlement body. Constructor alternatives are ledger Word64.
test recovery_keeps_constructor_above_javascript_safe_integer() {
  let body = builtin.constr_data(9_007_199_254_740_992, [])
  let raw: Data = outer_request(body)
  let recovered = decode.request(raw)
  builtin.serialise_data(body) == #"d866821b002000000000000080" && validation.valid_request(
    recovered,
  ) && !validation.valid_settlement_request(recovered, Ada)
}

fn deep_list_body(depth: Int) -> Data {
  if depth == 0 {
    builtin.i_data(0)
  } else {
    builtin.list_data([deep_list_body(depth - 1)])
  }
}

test recovery_keeps_65_deep_economic_body() {
  let raw: Data = outer_request(deep_list_body(65))
  let recovered = decode.request(raw)
  validation.valid_request(recovered) && !validation.valid_settlement_request(
    recovered,
    Ada,
  )
}
