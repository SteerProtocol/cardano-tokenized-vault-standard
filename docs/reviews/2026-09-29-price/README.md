# Price implementation and verification, 29 September 2026

This record preserves the earlier conversion-only provider snapshot. The
[subsequent all-methods update](../2026-09-29-price-all-methods/README.md) has a
different program hash and fresh local verification; the node receipts below
do not establish node acceptance of that updated program.

The common Price codec, exact LendingA provider binding, complete whitepaper
walkthrough and signed construction tests close the six proposed implementation
gaps within the isolated example. The public type remains `Price`, with encoded
version 1. No dependency, indexer service package or core custody rule was added.

| Verification | Result |
| --- | --- |
| TypeScript unit/property/harness | 331 passed, including 19 Price codec cases |
| Shared byte vector | Same preferred all-six-method bytes encoded/decoded in TypeScript and Aiken |
| CTVS-1 Aiken | 107 passed |
| CTVS-2 Aiken | 130 passed |
| Isolated provider handlers | 27 passed |
| Signed local integration | 39 passed, including 8 Price scenarios |
| Positive node acceptance | Witness checkpoint, reference checkpoint and 16-assertion reference checkpoint submitted and observed |
| Direct node readback | Final checkpoint output retains 50,000,000,000 receipts, 5,000,000 lovelace and inline value 550,000,000 |

Shared Aiken tests run in both families, so these counts are not additive unique
cases. The full offline gate is `VITEST_MAX_WORKERS=4 AIKEN=/path/to/pinned/aiken
npm run check` from `reference/`. The optional node tool is documented in
[NODE-TEST.md](../../../reference/examples/price-provider/NODE-TEST.md).

The tests cover exact constructor ordering, duplicate-query rejection,
equivalent CBOR spellings, quantity/evidence bounds, mixed units, zero and
fractional views, exact large intermediate arithmetic, overflow rejection,
unsupported operations, false assertions, receipt diversion and state
replacement. The common codec is structural. LendingA verifies only
ConvertToAssets; structural support for six methods does not advertise economic
support for all six. Exact-output rounding is encoded and documented but is not
a LendingA action implementation.

The signed local suite registers a reward credential and publishes actual
programs, verifies signatures over final transaction bodies, evaluates both
purposes against final CBOR and declared budgets, submits to the emulator and
reads the successor. Negative cases must reach compiled evaluation. A replaced
source invalidates its old pointer and old result; recalculation succeeds.

The separate node run uses cardano-node 11.0.1, Ogmios 7.0.0 and Kupo 2.12.0,
Conway protocol 10.0, magic 42, generated test keys and no external peers. Native
policies are issuer-controlled fixtures. Program identities and final CBOR are
retained in [node-binding.json](node-binding.json) and
[node-transactions.json](node-transactions.json). The final output was also
queried directly through `cardano-cli`; see
[node-ledger-readback.json](node-ledger-readback.json). Keys are not retained in
this review bundle.

| Signed checkpoint | Bytes | Measured memory | Measured steps |
| --- | ---: | ---: | ---: |
| Local 16 assertions, witnesses | 7,323 | 2,926,851 | 1,265,901,129 |
| Local 16 assertions, references | 1,100 | 2,935,239 | 1,271,152,083 |

The local envelope is 16,384 bytes, 14,000,000 memory units and 10,000,000,000
steps. The generated node's actual parameters are saved separately in
[node-protocol-parameters.json](node-protocol-parameters.json): its default
transaction memory ceiling is 140,000,000. The stricter local test independently
passes; the node run does not establish production-network capacity. Actual
costs are fixture-specific, not a universal 16-assertion promise or a measurement
of arbitrary maximum-sized evidence. Reference-script fees and publication
costs are distinct from checkpoint execution cost.

Docker images used:

```text
ghcr.io/intersectmbo/cardano-node:11.0.1
sha256:007da778998d0bdb043fb834c62b9da1c95e33610f31f6f9cccab29a945e2b99
cardanosolutions/ogmios:v7.0.0
sha256:8892ef5f77b94f1c95427cf9f2b40e6235a32b27a8b1e378db02289f3991617f
cardanosolutions/kupo:v2.12.0
sha256:7d3c62368a4a5a609f5cf0ee6949eb8d491ed8f5a4d05b38da3213d95735f03b
```

The compiler remains `aiken v1.1.22+39d6b04`. Source hashes and the local resource
records are in [validation.json](validation.json); the retained offline log is
[check.log](check.log). Source hashes bind this working-tree implementation,
not a public release.

Signed reports remain unsupported. Adding them requires a separate binding for
authorized reporters, exact signed bytes/domain, market and asset identities,
scale, validity interval and accounting-state reconciliation. Existing vault
validators, planners and wallet policies still reject Price withdrawals;
managed composition requires its own reviewed allocation/authorization profile.
No generic debt engine, liquidity reservation or NAV reporter was introduced.

Positive node acceptance applies to this hypothetical checkpoint only. Negative
node submission, production market accounting/NFT uniqueness, independent
provider implementations, core vault node acceptance, rollback, public deployment
and security audit remain outside the demonstrated result. The whitepaper's
conformance requirements remain broader than this fixture.
