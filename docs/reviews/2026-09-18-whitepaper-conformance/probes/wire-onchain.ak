use aiken/builtin
use aiken/collection/list
use aiken/interval.{Finite, Interval, IntervalBound}
use cardano/address.{from_script, from_verification_key}
use cardano/assets
use cardano/transaction.{InlineDatum, Input, NoDatum, Output, OutputReference, Spend, Transaction}
use ctvs/wire.{Cancel, Datum, Destination, KeyController, Recovery, Request, RequestAction, RequestSpend}
use vault

/// Actual validator entrypoint checks. Complete visible values are balanced;
/// signatures/collateral and full serialized ledger acceptance remain separate.
const policy = #"11111111111111111111111111111111111111111111111111111111"

const controller = #"22222222222222222222222222222222222222222222222222222222"

const token_policy = #"33333333333333333333333333333333333333333333333333333333"

const txid = #"4444444444444444444444444444444444444444444444444444444444444444"

fn ref(index: Int) -> OutputReference {
  OutputReference { transaction_id: txid, output_index: index }
}

fn range(lower: Int, upper: Int) -> Interval {
  Interval {
    lower_bound: IntervalBound { bound_type: Finite(lower), is_inclusive: True },
    upper_bound: IntervalBound {
      bound_type: Finite(upper),
      is_inclusive: False,
    },
  }
}

fn request_datum(version: Int, body: Data) -> Datum {
  Request {
    magic: wire.magic,
    wire_version: version,
    recovery: Recovery {
      vault_policy: policy,
      controller: KeyController { key_hash: controller },
      refund: Destination {
        address: from_verification_key(controller),
        datum: None,
      },
      deadline_posix_ms: 1_000,
    },
    // Neither unsupported constructor nor settlement byte limit may block refund.
    economic_body: body,
  }
}

fn fixture(
  version: Int,
  action: RequestAction,
  lower: Int,
  upper: Int,
  body: Data,
) -> (Transaction, Data, Data) {
  let raw_datum: Data = request_datum(version, body)
  let redeemer: Data = RequestSpend {
    magic: wire.magic,
    wire_version: 2,
    action,
  }
  let escrow = assets.from_lovelace(3_500_000)
    |> assets.add(token_policy, #"554e4954", 101_000)
    |> assets.add(token_policy, #"4558545241", 7)
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [
      Input {
        output_reference: ref(0),
        output: Output {
          address: from_script(policy),
          value: escrow,
          datum: InlineDatum(raw_datum),
          reference_script: None,
        },
      },
      Input {
        output_reference: ref(1),
        output: Output {
          address: from_verification_key(controller),
          value: assets.from_lovelace(5_000_000),
          datum: NoDatum,
          reference_script: None,
        },
      },
    ],
    outputs: [
      Output {
        address: from_verification_key(controller),
        value: escrow,
        datum: NoDatum,
        reference_script: None,
      },
      Output {
        address: from_verification_key(controller),
        value: assets.from_lovelace(4_600_000),
        datum: NoDatum,
        reference_script: None,
      },
    ],
    fee: 400_000,
    extra_signatories: [controller],
    validity_range: range(lower, upper),
    redeemers: [Pair(Spend(ref(0)), redeemer)],
  }
  (tx, raw_datum, redeemer)
}

fn balanced(tx: Transaction) -> Bool {
  let incoming = list.foldl(
    tx.inputs,
    tx.mint,
    fn(input, value) { assets.merge(input.output.value, value) },
  )
  let outgoing = list.foldl(
    tx.outputs,
    assets.from_lovelace(tx.fee),
    fn(output, value) { assets.merge(output.value, value) },
  )
  incoming == outgoing
}


// Fresh review probe: preserve the supported recovery envelope while changing
// only the deliberately untyped economic body. These are compiled handler
// contexts, not signed ledger transactions.
test wire_review_large_constructor_body_remains_cancelable() {
  let body = builtin.constr_data(9_007_199_254_740_992, [])
  let (tx, raw, action) = fixture(2, Cancel { refund_output: 0 }, 100, 200, body)
  balanced(tx) && vault.vault.spend(ref(99), txid, Some(raw), action, ref(0), tx)
}

fn nested_body(depth: Int) -> Data {
  if depth == 0 { builtin.i_data(0) } else { builtin.list_data([nested_body(depth - 1)]) }
}

test wire_review_65_deep_body_remains_cancelable() {
  let (tx, raw, action) = fixture(2, Cancel { refund_output: 0 }, 100, 200, nested_body(65))
  balanced(tx) && vault.vault.spend(ref(99), txid, Some(raw), action, ref(0), tx)
}
