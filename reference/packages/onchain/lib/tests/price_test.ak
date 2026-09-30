// Candidate Price wire boundaries. Rejection tests must evaluate the decoder
// and fail there; returning False alone would not prove an expected failure.

use aiken/builtin
use aiken/collection/list
use ctvs/price.{
  ConvertToAssets, ConvertToShares, PreviewDeposit, PreviewMint, PreviewRedeem,
  PreviewWithdraw, Price,
}
use ctvs/wire.{Ada, NativeAsset}

fn fixture() -> Price {
  Price {
    version: 1,
    market_id: NativeAsset {
      policy_id: #"11111111111111111111111111111111111111111111111111111111",
      asset_name: #"4d41524b4554",
    },
    share_asset: NativeAsset {
      policy_id: #"22222222222222222222222222222222222222222222222222222222",
      asset_name: #"5348415245",
    },
    underlying_asset: Ada,
    assertions: [
      ConvertToAssets { shares: 500_000_000, assets: 550_000_000 },
      ConvertToShares { assets: 550_000_000, shares: 500_000_000 },
      PreviewDeposit { assets_in: 112, shares_out: 100 },
      PreviewMint { shares_out: 100, assets_in: 112 },
      PreviewWithdraw { assets_out: 109, shares_in: 100 },
      PreviewRedeem { shares_in: 100, assets_out: 109 },
    ],
    evidence: builtin.constr_data(0, []),
  }
}

fn fields() -> List<Data> {
  let raw: Data = fixture()
  builtin.un_constr_data(raw).2nd
}

fn with_assertions(assertions: List<Data>) -> Data {
  expect [v, market, share, underlying, _, evidence] = fields()
  builtin.constr_data(
    0,
    [v, market, share, underlying, builtin.list_data(assertions), evidence],
  )
}

fn roundtrip(p: Price) -> Bool {
  let raw: Data = p
  price.decode(raw) == p
}

fn numeric_assertion(tag: Int, quantities: List<Int>) -> Data {
  builtin.constr_data(tag, list.map(quantities, builtin.i_data))
}

test all_methods_roundtrip() {
  roundtrip(fixture())
}

test constructor_tags_and_input_first_order_are_fixed() {
  let p = fixture()
  list.all(
    list.indexed_map(
      p.assertions,
      fn(index, assertion) {
        let raw: Data = assertion
        let Pair(tag, quantities) = builtin.un_constr_data(raw)
        expect [input, _] = quantities
        let Pair(method, amount) = price.query_key(assertion)
        expect typed_input: Int = input
        tag == index && method == index && typed_input == amount
      },
    ),
    fn(valid) { valid },
  )
}

test distinct_amounts_for_same_method_are_allowed() {
  let p = fixture()
  roundtrip(
    Price {
      ..p,
      assertions: [
        ConvertToAssets { shares: 0, assets: 0 },
        ConvertToAssets { shares: 1, assets: 2 },
      ],
    },
  )
}

test structural_limit_accepts_sixteen_unique_queries() {
  let p = fixture()
  roundtrip(
    Price {
      ..p,
      assertions: list.map(
        list.range(0, 15),
        fn(n) { ConvertToAssets { shares: n, assets: n } },
      ),
    },
  )
}

test shape_does_not_prove_economic_truth() {
  let p = fixture()
  // A native provider must reject this lie; a generic decoder cannot price it.
  roundtrip(
    Price {
      ..p,
      assertions: [ConvertToAssets { shares: 500, assets: 999_999 }],
    },
  )
}

test duplicate_query_with_conflicting_result_fails() fail {
  let p = fixture()
  let raw: Data = Price {
    ..p,
    assertions: [
      ConvertToAssets { shares: 500, assets: 550 },
      ConvertToAssets { shares: 500, assets: 551 },
    ],
  }
  expect _ = price.decode(raw)
  True
}

test identical_duplicate_fails() fail {
  let p = fixture()
  let raw: Data = Price {
    ..p,
    assertions: list.concat(p.assertions, p.assertions),
  }
  expect _ = price.decode(raw)
  True
}

test empty_assertions_fail() fail {
  expect _ = price.decode(with_assertions([]))
  True
}

test seventeen_queries_fail() fail {
  let p = fixture()
  let raw: Data = Price {
    ..p,
    assertions: list.map(
      list.range(0, 16),
      fn(n) { ConvertToAssets { shares: n, assets: n } },
    ),
  }
  expect _ = price.decode(raw)
  True
}

test unknown_version_fails() fail {
  let p = fixture()
  let raw: Data = Price { ..p, version: 2 }
  expect _ = price.decode(raw)
  True
}

test unknown_operation_fails() fail {
  expect _ = price.decode(with_assertions([numeric_assertion(6, [0, 0])]))
  True
}

test extra_assertion_field_fails() fail {
  expect _ = price.decode(with_assertions([numeric_assertion(0, [0, 0, 0])]))
  True
}

test missing_assertion_field_fails() fail {
  expect _ = price.decode(with_assertions([numeric_assertion(0, [0])]))
  True
}

test wrong_quantity_type_fails() fail {
  expect _ = price.decode(
    with_assertions(
      [builtin.constr_data(0, [builtin.b_data(#"00"), builtin.i_data(0)])],
    ),
  )
  True
}

test negative_quantity_fails() fail {
  expect _ = price.decode(with_assertions([numeric_assertion(0, [-1, 0])]))
  True
}

test quantity_overflow_fails() fail {
  expect _ = price.decode(
    with_assertions([numeric_assertion(0, [0, wire.max_q + 1])]),
  )
  True
}

test extra_envelope_field_fails() fail {
  expect _ = price.decode(
    builtin.constr_data(0, list.concat(fields(), [builtin.i_data(0)])),
  )
  True
}

test wrong_envelope_tag_fails() fail {
  expect _ = price.decode(builtin.constr_data(1, fields()))
  True
}

test malformed_asset_arity_fails() fail {
  expect [v, market, share, _, claims, evidence] = fields()
  expect _ = price.decode(
    builtin.constr_data(
      0,
      [v, market, share, numeric_assertion(0, [0]), claims, evidence],
    ),
  )
  True
}

test malformed_asset_identity_fails() fail {
  let p = fixture()
  let raw: Data = Price {
    ..p,
    share_asset: NativeAsset { policy_id: #"00", asset_name: #"" },
  }
  expect _ = price.decode(raw)
  True
}

test oversized_evidence_fails() fail {
  let p = fixture()
  let raw: Data = Price {
    ..p,
    evidence: builtin.b_data(builtin.replicate_byte(1025, 0)),
  }
  expect _ = price.decode(raw)
  True
}
