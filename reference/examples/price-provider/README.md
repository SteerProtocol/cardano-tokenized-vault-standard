# Executable Price evidence example

This isolated Aiken project demonstrates the claim, evidence and consumer flow
from the meeting. It uses a hypothetical protocol called LendingA. It is not a
Liqwid adapter, a SteelSwap implementation, or a complete lending protocol.

## Run it

From `reference/`, with the repository's pinned Aiken compiler available:

```sh
npm run test:price-example
# Or select the pinned binary explicitly:
AIKEN=/path/to/aiken npm run test:price-example
```

The command stages the canonical shared Price decoder and its dependencies,
compiles the provider and consumer validators, and runs the example's handler
tests. It writes a blueprint, source hashes and test reports to
`reference/artifacts/price-provider/`. The normal `npm run check` includes this
example. Its validators are not added to the CTVS-1 or CTVS-2 blueprints.

## Follow the code

| File | Responsibility |
| --- | --- |
| [lending_a.ak](onchain/lib/example/lending_a.ak) | Decode exact evidence and native state; authenticate the configured state address and market NFT; verify all six conversions and previews |
| [lending_a_price.ak](onchain/validators/lending_a_price.ak) | Withdrawal validator that decodes the common Price claim and invokes native verification |
| [receipt_consumer.ak](onchain/validators/receipt_consumer.ak) | Spending validator that requires the approved provider and records a claim matched to receipts actually held |
| [fixtures.ak](onchain/lib/example/fixtures.ak) | One transaction context containing the claim, accounting evidence, code reference and receipt position |
| [flow_test.ak](onchain/validators/flow_test.ak) | Positive flow and adversarial mutations evaluated against the compiled handlers |
| [pricing_test.ak](onchain/validators/pricing_test.ak) | All six economic methods, rounding, deficit and overflow cases, plus generated ratio and false-result checks |

## The concrete transaction

The fixture distinguishes four outputs by reference:

```text
Consumed input #0:
  consumer script
  50,000,000,000 receipt units + 2,000,000 lovelace
  previous valuation checkpoint

Reference input #2:
  configured LendingA state address
  1 configured market-state NFT
  native datum: MarketState {
    accounted_assets: 1,100,000,000,000
    receipt_supply:   100,000,000,000,000
  }

Reference input #3:
  reference-script hash for the approved provider
  no accounting datum

Withdrawal:
  credential: Script(approved_provider_hash)
  amount: 0
  redeemer: Price {
    version: 1
    market_id, share_asset, underlying_asset
    assertions: [
      ConvertToAssets {
        shares: 50,000,000,000
        assets: 550,000,000
      }
    ]
    evidence: OnChain { market_state_ref: #2 }
  }

Successor output #0:
  same consumer address and complete input value
  datum: checkpoint(550,000,000)
```

All references in code use a full synthetic 32-byte transaction hash and output
index. Receipts have eight display decimals and USDCX has six. This is 500 receipts
valued at 550 USDCX. Neither exponent is supplied by the builder.

The provider decodes `Price`, then independently decodes the provider-specific
`OnChain` evidence. It finds reference input #2, checks its address and NFT, reads
its native datum, and computes:

```text
floor(50,000,000,000 * 1,100,000,000,000 / 100,000,000,000,000)
= 550,000,000
```

All six `PriceAssertion` methods are supported against the same authenticated
snapshot. With backing `B` and strictly positive supply `S`, the no-fee formulas
are:

| Method | Verified result |
| --- | --- |
| `ConvertToAssets(shares)` | floor(shares times B / S) |
| `ConvertToShares(assets)` | floor(assets times S / B) |
| `PreviewDeposit(assets_in)` | floor(assets_in times S / B) |
| `PreviewMint(shares_out)` | ceil(shares_out times B / S) |
| `PreviewWithdraw(assets_out)` | ceil(assets_out times S / B) |
| `PreviewRedeem(shares_in)` | floor(shares_in times B / S) |

There are no operation fees, so the exact-input previews equal their corresponding
conversions. Zero inputs produce zero results when backing and supply are positive.
At zero backing, only `ConvertToAssets` and `PreviewRedeem` are accepted, with
result zero. The other four methods reject even zero inputs: this example does
not define a deficit recapitalization or free-mint policy. Zero supply always
rejects; bootstrap is not implemented. Intermediate products use exact integers;
results outside the common quantity bound cannot be accepted by clamping.

Multiple distinct assertions are allowed, and all must be correct. A valid
selected conversion does not excuse a false extra conversion or preview.
Unknown operation tags still fail in the common decoder. Preview verification
does not execute a deposit, mint, withdrawal or redemption.

The consumer does not decode LendingA's native state or recalculate its ratio.
It requires the approved provider's zero withdrawal and reads the corresponding
redeemer by script purpose. It matches the configured market and asset pair,
selects the conversion for the receipts in its consumed input, preserves custody,
and requires the successor checkpoint to equal the claimed value.

The fixture deliberately includes both handlers in the same test flow. A
well-formed lie can pass the consumer's selection and custody checks by itself,
but the provider rejects it, so the combined flow fails. In an actual ledger
transaction, the ledger requires every invoked script to pass.

## Evidence is data, not executable code

`OnChain` is constructor 0 with exactly one `OutputReference`; that reference is
constructor 0 with exactly a transaction hash and output index. The provider
requires a 32-byte hash and an index in 0..65,535. LendingA's native `MarketState`
is constructor 0 with exactly two bounded integers, nonnegative backing and
strictly positive receipt supply.

Reference input #2 supplies accounting data. Reference input #3 represents the
separate location supplying compiled code. Merely including #3 does not execute
the provider: the withdrawal invocation does. The evidence pointer does not copy
the datum into the redeemer or cause the script to fetch it.

## What the tests establish

The suite accepts the 500-to-550 flow and all six no-fee pricing methods, including
fractional floor/ceiling results and mixed display decimals. It checks zero inputs,
maximum quantities, exact intermediate arithmetic, zero-backing behavior and
generated ratios, and rejects false results for every method. Mint underpayment,
withdrawal underburn and overquoted exact-output costs reject. It also rejects
false selected and extra claims, missing state,
a code reference used as accounting evidence, missing NFT, wrong source address,
malformed evidence/native datums, zero supply, negative backing, and a mismatched
asset pair. Consumer checks reject missing or unapproved withdrawals, nonzero
withdrawals, missing provider redeemers, quotes for another receipt quantity,
diverted receipts, incorrect successor values, and two positions sharing one
successor.

The configured market NFT must really be unique and its native state transitions
must enforce correct accounting. This example assumes those upstream guarantees;
it does not implement or prove LendingA's minting or transition policies.

The Aiken handler suite uses synthetic transaction contexts.
They do not submit signed transactions, validate phase-1 rules, register reward
credentials, publish reference scripts or demonstrate ledger witness resolution.
The code-reference field contains a placeholder hash as seen by scripts, not the
program bytes. The generated blueprint contains the actual parameterized programs
for inspection; the fixture hashes are not derived deployments of those programs.

The consumer is only a receipt-value checkpoint, refreshable by anyone who
satisfies both validators. It preserves the position's custody, but is not a vault
deposit or redemption flow and does not prove available liquidity. The checkpoint
records the value at that transaction's evidence basis; it is not automatically
current after LendingA's state changes. There is no signature reporter, accrual,
bootstrap procedure or external-state update mechanism in this example.

## Signed transaction and codec verification

After compiling the example, run:

```sh
npx vitest run --project integration testing/integration/price/lifecycle.test.ts
npx vitest run --project unit packages/protocol/tests/price.test.ts
```

The [signed fixture](../../testing/fixtures/price/index.ts) parameterizes actual
compiled programs, derives their hashes, mints test assets through a native
signature policy, registers the provider reward credential, and publishes both
reference programs in separate ledger outputs. It then builds the same checkpoint
using either full program witnesses or reference inputs. The final signed CBOR is
re-evaluated for both Spend and Withdraw purposes, checked against declared and
aggregate execution budgets and the transaction-size limit, submitted to Lucid's
local emulator and read back. Actual signatures are verified against the body.

Evidence under `artifacts/price-signed/` includes program identities, native
source/code references, final CBOR, protocol parameters and per-purpose costs.
The default suite is local verification. An opt-in [node acceptance tool](NODE-TEST.md)
previously submitted and observed both paths, including a 16-assertion reference
path, on an isolated magic-42 Cardano network. That retained trace used the earlier
conversion-only provider, not the current six-method program. The current signed
local suite verifies all six methods, false results alongside a valid consumer
query, and a mixed 16-assertion envelope through both program-source paths. This
does not establish public-network deployment or production market accounting.
The issuer-controlled NFT fixture does not prove production NFT uniqueness or a
lending market's transition accounting. The shared TypeScript codec also checks
all six constructors against a committed byte vector decoded and serialized by
Aiken. That vector is structural; the separate provider tests establish LendingA's
no-fee snapshot verification for all six methods.

See [BINDING.md](BINDING.md) for the exact supported capability and
[the whitepaper walkthrough](../../../whitepaper/CTVS-1.md#ctvs1-price-walkthrough)
for construction, decoding and lifecycle boundaries.
