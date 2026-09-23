// CTVS-2 decodes only Batch and administrative State actions. Public tags remain
// unchanged; direct-operation payloads are rejected before recursive decoding.

use aiken/builtin
use ctvs/wire.{
  ActionEnvelope, Batch, CollectFees, SetPause, SettleEntry, StateAction,
  StateSpend, TopUpReserve,
}

fn state_action(raw: Data) -> StateAction {
  let Pair(tag, fields) = builtin.un_constr_data(raw)
  when tag is {
    4 -> {
      expect [state_raw, entries_raw, reward_raw, reward_output_raw] = fields
      expect entries: List<SettleEntry> = entries_raw
      expect reward_output: Option<Int> = reward_output_raw
      Batch {
        state_output: builtin.un_i_data(state_raw),
        entries,
        reward_key: builtin.un_b_data(reward_raw),
        reward_output,
      }
    }
    5 -> {
      expect [state_raw, fee_raw] = fields
      CollectFees {
        state_output: builtin.un_i_data(state_raw),
        fee_output: builtin.un_i_data(fee_raw),
      }
    }
    6 -> {
      expect [amount_raw, state_raw] = fields
      TopUpReserve {
        additional_lovelace: builtin.un_i_data(amount_raw),
        state_output: builtin.un_i_data(state_raw),
      }
    }
    7 -> {
      expect [flags_raw, state_raw] = fields
      SetPause {
        pause_flags: builtin.un_i_data(flags_raw),
        state_output: builtin.un_i_data(state_raw),
      }
    }
    _ -> fail
  }
}

pub fn state_action_envelope(raw: Data) -> ActionEnvelope {
  let Pair(tag, fields) = builtin.un_constr_data(raw)
  expect tag == 0
  expect [magic_raw, version_raw, action_raw] = fields
  StateSpend {
    magic: builtin.un_b_data(magic_raw),
    wire_version: builtin.un_i_data(version_raw),
    action: state_action(action_raw),
  }
}
