# Price provider interface candidate

Status: a shared Aiken type and structural decoder, not a deployed pricing
provider or a managed-vault conformance claim. The implementation is
[`ctvs/price.ak`](../reference/packages/onchain/lib/ctvs/price.ak).

## Purpose and boundary

A transaction builder supplies a `Price` redeemer containing accounting claims.
A protocol-specific withdrawal validator authenticates its evidence and verifies
every claim. A consuming validator requires the approved provider invocation and
reads the same redeemer. The provider does not return a value through a call.

Native protocols retain their datums and accounting. The common interface fixes
the meaning of claims, while the provider implements their verification. Debt
discovery, interest accrual and strategy execution remain protocol-specific;
shareholder-value claims must still reflect applicable liabilities under the
declared accounting perimeter. A signature identifies an approved reporter; it
does not independently establish economic truth.

## Public shape and encoding

The public type is `Price`, without a version suffix. Compatibility is explicit
through `version = 1`, not inferred from the source-level type name. This is a
separate candidate interface, not a new WIRE-2 direct-custody action or datum.

`Price` is Plutus Data constructor 0 with exactly six fields, in this order:

1. `version`: integer 1. Unknown versions fail.
2. `market_id`: `ctvs/wire.Asset`, interpreted and authenticated by the provider.
3. `share_asset`: the exact share or receipt asset identity.
4. `underlying_asset`: the exact asset in which results are denominated.
5. `assertions`: a nonempty list of at most 16 typed assertions.
6. `evidence`: provider-specific Plutus Data.

Assets retain the shared encoding: ADA is constructor 0 with no fields; a native
asset is constructor 1 with a 28-byte policy ID and a 0..32-byte asset name.
Identifiers establish a claim's subject, not its authenticity. Providers must
pin or authenticate the relevant market and asset pair, and consumers must match
them against their approved configuration. The candidate does not require that
the market identifier itself be a state NFT or prove a singleton by its syntax.

Every assertion has exactly two integer fields. Its fixed input is first and its
claimed result second, including exact-output mint and withdrawal operations:

| Tag | Constructor | First field | Second field | Result rounding |
| --- | --- | --- | --- | --- |
| 0 | `ConvertToAssets` | `shares` | `assets` | Down |
| 1 | `ConvertToShares` | `assets` | `shares` | Down |
| 2 | `PreviewDeposit` | `assets_in` | `shares_out` | Down |
| 3 | `PreviewMint` | `shares_out` | `assets_in` | Up |
| 4 | `PreviewWithdraw` | `assets_out` | `shares_in` | Up |
| 5 | `PreviewRedeem` | `shares_in` | `assets_out` | Down |

Quantities are integer ledger base units in 0..2^63-1, matching the reference
quantity bound. Conversion methods exclude operation entry/exit fees. Previews
include the provider's declared operation fees, but do not bundle wallet network
fees or storage ADA into the underlying amount. Providers must publish their
exact arithmetic, including intermediate rounding, accrued accounting fees,
bootstrap and deficit behavior. These types do not supply a universal formula.

The pair `(operation tag, first field)` identifies a query within one envelope.
Duplicate queries fail even if their claimed results agree. List order is not a
selection mechanism: consumers match the operation and fixed input exactly.

The initial evidence budget reuses `validation.valid_bounded_data`: at most
1,024 normalized serialized bytes, 256 nodes, depth 16, constructor tags 0..127,
bounded byte strings and signed 256-bit integers, with no duplicate map keys.
This is a conservative candidate bound, not a claim that 16 assertions and their
verification fit a ledger transaction. A real provider must be measured against
its evidence and resource needs before adopting these limits.

## Provider and consumer responsibilities

The generic `decode` function checks exact constructors and field counts, version,
asset syntax, quantity bounds, assertion count, uniqueness and evidence bounds.
`valid_shape` performs the structural checks on an already typed `Price`.
Neither function authenticates evidence or validates any price. A well-formed
lie can pass both; a provider must then reject it through economic verification.

A provider must reject unsupported operations and verify every assertion against
one coherent accounting basis. Its published evidence schema specifies how to
authenticate native state, configuration, time-dependent accrual, and any signed
reports. Reference-state reads and transitions consuming that same state need
explicit pricing-basis rules. Owner-dependent quotes require authenticated
context and a consumer binding rule; the context-free candidate must not be
advertised as supporting those cases without that specification.

A consumer must require the exact approved script withdrawal credential, check
the intended zero withdrawal, resolve its redeemer by semantic script purpose,
decode `Price`, match market/assets and select the exact query. It still checks
its own custody, liabilities, minting, user bounds and output destinations.
Source authentication, signatures and freshness cannot be replaced by successful
structural decoding or transaction-builder trust.

For absolute NAV reports, the provider must enforce the accounting-state basis
and accepted report rules, or a proved equivalent reconciliation, so stale
reports cannot erase intervening cash flows. This is distinct from reusing a
conversion claim about an authenticated source position.

## Example

An illustrative provider for a market with six-decimal receipts and underlying:

```text
Price {
  version: 1
  market_id: configured market identity
  share_asset: configured receipt token
  underlying_asset: configured USDCX token
  assertions: [
    ConvertToAssets { shares: 500000000, assets: 550000000 }
    PreviewMint { shares_out: 100000000, assets_in: 112000000 }
  ]
  evidence: protocol-specific authenticated market and fee evidence
}
```

The provider checks both assertions; the consumer can use the conversion to value
receipts it actually owns. These illustrative rates and fees do not describe a
real lending deployment.

## Liquidity and implementation status

Conversions and previews are accounting claims, not liquidity reservations or
proof of a successfully constructed action. Available liquidity, owner-specific
withdrawal limits, authorized unwinds and deferred settlement need separately
specified capabilities. No generic liquidity number is added to `Price`.

The common module implements the Aiken schema, strict decoder, query identity
helper and boundary tests. The separate [executable LendingA example](../reference/examples/price-provider/README.md)
adds a hypothetical native-state provider and custody-preserving consumer, with
compiled handler tests for all six methods under a no-fee snapshot binding and
signed local execution. An opt-in isolated node acceptance trace is retained for
the earlier conversion-only provider, not this updated program. It is not
an integration with a deployed protocol. The shared codec and signed local
construction tests are available; a signature verifier and managed vault state
are not implemented. Existing vaults still reject
withdrawals through `ledger.allowed_purposes`; enabling composition requires a
separate reviewed change to validators, planners and wallet effect checks.
The whitepaper describes this optional candidate in CTVS-1 Sections 6.5 through 6.7 and
Appendix B, with managed and asynchronous accounting cross-references. Inclusion
in the publication does not enable withdrawals in the existing reference vaults
or establish managed execution conformance.
