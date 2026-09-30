# LendingA verification for all six Price methods

The isolated provider now verifies ConvertToAssets, ConvertToShares,
PreviewDeposit, PreviewMint, PreviewWithdraw and PreviewRedeem against one
authenticated native snapshot. The native datum, evidence shape, common Price
encoding and core vault validators are unchanged. No operation fees or
time-dependent accrual are introduced. This is economic verification of quotes,
not implementation of deposits, withdrawals or share mint/burn execution.

## Arithmetic and edge cases

Exact-input outputs round down. Exact-output inputs round up. All quantities
remain raw ledger units; display decimals are not inputs to the calculation.
The existing state authentication runs before every method's arithmetic.
Every assertion must be correct, including assertions not selected by the
receipt checkpoint consumer.

At zero backing, ConvertToAssets and PreviewRedeem verify zero value; the other
four methods reject, including zero-input queries. At positive backing, all six
accept zero input with zero result. Zero supply rejects for every method. This
binding supplies neither bootstrap nor deficit recapitalization. Large products
use exact integer arithmetic; out-of-range economic results cannot be clamped
into an accepted claim.

## Verification

The full offline gate passed with the pinned Aiken compiler:

```sh
cd reference
VITEST_MAX_WORKERS=4 AIKEN=/path/to/aiken npm run check
```

| Layer | Result |
| --- | --- |
| TypeScript unit/property/harness | 331 passed |
| CTVS-1 Aiken | 107 passed |
| CTVS-2 Aiken | 130 passed |
| Isolated provider | 44 passed: 42 unit and 2 generated properties |
| Integration | 39 passed, including 8 Price scenarios |

Shared tests run in both vault families, so the counts are not additive unique
cases. The new provider suite adds 17 cases. Generated properties each run 100
scenarios, use an independent quotient/remainder ceiling oracle, and verify both
correct results and rejection of a one-unit false result for every method.
Deterministic vectors cover exact and fractional division, mixed decimals, zero
inputs, zero backing, maximum quantities, overflow, underpayment, underburn and
overquoted exact-output costs. No fee-bearing pricing is advertised or tested.

An existing consumer test now supplies a correct native quote for the wrong
receipt quantity. It first requires provider success, then tests consumer
rejection. Previously its erroneous quote rejected at the provider and did not
establish the intended consumer boundary.

The signed suite parameterizes actual programs and verifies all six methods,
including fractional ceiling queries, through both witnesses and reference
scripts. A false result for each new method rejects through compiled phase-two
execution even alongside the consumer's correct conversion. A valid redemption
preview alone cannot replace the consumer's required ConvertToAssets assertion.
Source replacement, custody preservation and false-price checks remain covered.

| Current signed fixture | Bytes | Memory | Steps |
| --- | ---: | ---: | ---: |
| Six methods, witnesses | 7,352 | 1,327,780 | 497,088,762 |
| Six methods, references | 865 | 1,340,062 | 504,917,193 |
| Mixed 16 assertions, witnesses | 7,619 | 3,171,924 | 1,337,675,693 |
| Mixed 16 assertions, references | 1,132 | 3,180,312 | 1,342,926,647 |

All four fit the unchanged local limits of 16,384 bytes, 14,000,000 memory units
and 10,000,000,000 steps. Measurements apply to these fixtures and evidence,
not arbitrary providers or maximum-sized evidence. Actual signed CBOR, resolved
inputs, final evaluations and protocol parameters are retained in
[signed-transactions.json](signed-transactions.json). Source bindings, program
identities and property seed are in [validation.json](validation.json), the
provider report is [aiken-tests.json](aiken-tests.json), and the complete gate log
is [check.log](check.log).

## Publication and limits of the result

The provider README, binding, interface notes and whitepaper Section 6.7 now
describe all six methods and the deficit rules. The publication was rebuilt and
the changed binding page visually inspected. The papers remain 51 and 41 pages,
with a 92-page combined edition; [publication.json](publication.json) records
page and link counts. Whitepaper package checksums were refreshed.

The applied provider hash changes with this program. Consumers must explicitly
approve the new hash, and builders must select the corresponding program bytes;
the signed fixtures derive both bindings from current compiled code. No public
deployment was updated. The [earlier node acceptance record](../2026-09-29-price/README.md)
applies to the old conversion-only program. This updated program has not been
rerun on a node. Production state/NFT correctness, signed reports, actual vault
composition, liquidity guarantees and independent interoperability remain outside
this result.
