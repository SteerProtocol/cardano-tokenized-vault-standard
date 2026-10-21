// Cross-language preferred bytes for the structural Price fixture.
// This is agreement with the TS encoder, not independent economic verification.
use aiken/builtin
use ctvs/price.{
  ConvertToAssets, ConvertToShares, PreviewDeposit, PreviewMint, PreviewRedeem,
  PreviewWithdraw, Price,
}
use ctvs/wire.{NativeAsset}

test shared_price_vector_matches_typescript_bytes() {
  let raw: Data = Price {
    version: 1,
    market_id: NativeAsset {
      policy_id: #"dddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      asset_name: #"4d41524b4554",
    },
    share_asset: NativeAsset {
      policy_id: #"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      asset_name: #"52454345495054",
    },
    underlying_asset: NativeAsset {
      policy_id: #"ffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      asset_name: #"5553444358",
    },
    assertions: [
      ConvertToAssets { shares: 50_000_000_000, assets: 550_000_000 },
      ConvertToShares { assets: 550_000_000, shares: 50_000_000_000 },
      PreviewDeposit { assets_in: 550_000_000, shares_out: 50_000_000_000 },
      PreviewMint { shares_out: 50_000_000_000, assets_in: 550_000_000 },
      PreviewWithdraw { assets_out: 550_000_000, shares_in: 50_000_000_000 },
      PreviewRedeem { shares_in: 50_000_000_000, assets_out: 550_000_000 },
    ],
    evidence: builtin.constr_data(
      0,
      [
        builtin.constr_data(
          0,
          [
            builtin.b_data(
              #"1111111111111111111111111111111111111111111111111111111111111111",
            ),
            builtin.i_data(2),
          ],
        ),
      ],
    ),
  }
  price.valid_shape(price.decode(raw)) && builtin.serialise_data(raw) == #"d8799f01d87a9f581cdddddddddddddddddddddddddddddddddddddddddddddddddddddddd464d41524b4554ffd87a9f581ceeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee4752454345495054ffd87a9f581cffffffffffffffffffffffffffffffffffffffffffffffffffffffff455553444358ff9fd8799f1b0000000ba43b74001a20c85580ffd87a9f1a20c855801b0000000ba43b7400ffd87b9f1a20c855801b0000000ba43b7400ffd87c9f1b0000000ba43b74001a20c85580ffd87d9f1a20c855801b0000000ba43b7400ffd87e9f1b0000000ba43b74001a20c85580ffffd8799fd8799f5820111111111111111111111111111111111111111111111111111111111111111102ffffff"
}
