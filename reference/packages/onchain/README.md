# Shared Aiken protocol package

This directory is the canonical source for the protocol types, exact scoped decoders, wire bounds, integer economics, ledger predicates, genesis and state transition primitives used by both independent reference implementations.

| Source | Responsibility |
| --- | --- |
| `lib/ctvs/wire.ak` | Public WIRE-2 profile 0 shapes and fixed constants |
| `lib/ctvs/decode.ak` | Exact role, constructor and arity checks without interpreting recovery economics |
| `lib/ctvs/validation.ak` | Normative structural and bounded-value predicates |
| `lib/ctvs/math.ak` | Integer previews with prescribed floor and ceiling rules |
| `lib/ctvs/ledger.ak` | Actual input, output, value and redeemer checks |
| `lib/ctvs/genesis.ak` | Seed consumption and permanent identity creation |
| `lib/ctvs/state_core.ak` | Authenticated configuration, state, administration and supply coupling |
| `lib/ctvs/testing.ak` | Shared transaction fixtures |
| `validators/config_lock.ak` | Permanently unspendable configuration output |

Family policy entrypoints remain in `implementations/ctvs1/onchain` and `implementations/ctvs2/onchain`. CTVS1 permits immutable execution modes 1, 2 and 3 and implements synchronous operations. CTVS2 permits modes 4, 8 and 12 and implements request settlement, independent recovery and claim delivery. Both reject unsupported mode bits at genesis and on authenticated state transitions. The public datum and action encodings retain their existing tags and field order.

## Reproducible consumption

Aiken 1.1.22 does not support local path dependencies; see the [workspace documentation](https://aiken-lang.org/fundamentals/getting-started#workspaces). The workspace build stages this package and one family into an isolated `.build/{family}` project, rejecting module collisions. It copies source bytes without rewriting them. The only generated module is `ctvs/deployment`, which binds the hashes of independently compiled configuration and claim scripts. No editable source copy is kept in either family.

The compiler and both remote libraries are pinned: Aiken `v1.1.22+39d6b04`, stdlib `v3.1.0` and fuzz `v2.2.0`. Each family owns an explicit manifest and dependency lock. Build manifests record the canonical source paths and SHA-256 hashes together with the final template hashes and byte sizes.

From `reference`, run:

```sh
AIKEN=/absolute/path/to/aiken npm run build
AIKEN=/absolute/path/to/aiken npm run test:onchain
```

The test command checks both isolated projects with warnings denied, seed `20260916` and 1,000 successful cases per property. Reports are written under `artifacts/ctvs1` and `artifacts/ctvs2`.

## Test provenance and properties

`test-provenance.json` maps all 122 original named tests to their canonical locations. Shared wire tests run in both family suites. Family fixtures authenticate mode 3 or mode 12, and the former capability-variant negative case now explicitly rejects valid async modes in the synchronous implementation. Unknown WIRE mode bits remain independently covered.

The shared property suite generates varied backing, supply, virtual shares, amounts and fees, including zero and maximum fee rates. It verifies integer floor and ceiling bounds, quote conservation, payout monotonicity, deposit/redeem round-trip non-profitability and mixed snapshot accounting. Independent family properties reject unsupported immutable modes and direct actions in the async entrypoint. Their `fail` annotation requires every generated case to reject, as defined in the [Aiken test documentation](https://aiken-lang.org/language-tour/tests#testing-failures).

CTVS2 additionally tests exact family decoding and exhaustive settlement traversal. Sorted unique entries each resolve an actual request input, and equality with the count of consumed requests proves complete coverage. The same traversal reserves distinct claim, state and reward output indices. Adversarial cases exercise duplicate and reversed entries, state substitution, omitted requests and index collisions.

These Aiken tests validate ledger contexts and compiled handlers. Complete signed transaction construction, selected local Emulator checks and actual publication size are checked separately by the workspace integration suite. Full cardano-node phase-1 validation is not claimed.
