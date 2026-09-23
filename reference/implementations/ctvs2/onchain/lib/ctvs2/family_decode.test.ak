// Keep the narrower CTVS-2 decoder compatible with supported public wire tags
// while rejecting extra, missing and malformed nested fields.

use aiken/builtin
use aiken/collection/list
use ctvs/testing.{envelope, key, ref}
use ctvs/wire.{Batch, CollectFees, SetPause, SettleEntry, TopUpReserve}
use ctvs2/family_decode

fn raw_envelope(action: Data) -> Data {
  builtin.constr_data(
    0,
    [builtin.b_data(wire.magic), builtin.i_data(2), action],
  )
}

test family_decoder_preserves_every_supported_action() {
  let actions = [
    Batch {
      state_output: 0,
      entries: [
        SettleEntry { request_ref: ref(1), claim_output: 1, claim_topup: 0 },
      ],
      reward_key: key,
      reward_output: None,
    },
    CollectFees { state_output: 0, fee_output: 1 },
    TopUpReserve { additional_lovelace: 1000000, state_output: 0 },
    SetPause { pause_flags: 3, state_output: 0 },
  ]
  list.all(
    actions,
    fn(action) {
      let expected = envelope(action)
      let decoded: Data = family_decode.state_action_envelope(expected)
      decoded == expected
    },
  )
}

test family_decoder_rejects_extra_outer_field() fail {
  let raw = envelope(SetPause { pause_flags: 3, state_output: 0 })
  let Pair(tag, fields) = builtin.un_constr_data(raw)
  expect _ = family_decode.state_action_envelope(
    builtin.constr_data(tag, list.concat(fields, [builtin.i_data(0)])),
  )
  True
}

test family_decoder_rejects_missing_admin_field() fail {
  expect _ = family_decode.state_action_envelope(
    raw_envelope(builtin.constr_data(7, [builtin.i_data(3)])),
  )
  True
}

test family_decoder_rejects_extra_admin_field() fail {
  expect _ = family_decode.state_action_envelope(
    raw_envelope(
      builtin.constr_data(
        6,
        [builtin.i_data(1), builtin.i_data(0), builtin.i_data(0)],
      ),
    ),
  )
  True
}

test family_decoder_rejects_malformed_nested_batch_entry() fail {
  let bad_entry = builtin.constr_data(
    0,
    [builtin.i_data(0), builtin.i_data(1), builtin.i_data(0)],
  )
  let action = builtin.constr_data(
    4,
    [
      builtin.i_data(0),
      builtin.list_data([bad_entry]),
      builtin.b_data(key),
      builtin.constr_data(1, []),
    ],
  )
  expect _ = family_decode.state_action_envelope(raw_envelope(action))
  True
}
