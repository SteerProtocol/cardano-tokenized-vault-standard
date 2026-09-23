# CTVS reference implementations

This workspace implements the supplied v0.6.3 whitepaper's WIRE-2, profile 0 as two separate contract projects and client APIs. Both have signed local lifecycle tests for ADA and native-token backing. See [VALIDATION.md](VALIDATION.md) for measured evidence and its limits.

| Implementation | Immutable execution modes | Contracts | Client |
| --- | --- | --- | --- |
| [CTVS-1](implementations/ctvs1/README.md) | `1`, `2`, `3` | F configuration lock and P synchronous vault | `@ctvs/ctvs1` |
| [CTVS-2](implementations/ctvs2/README.md) | `4`, `8`, `12` | F configuration lock, P asynchronous vault and Q claim guard | `@ctvs/ctvs2` |

CTVS-1 implements deposit, mint, withdraw and redeem. CTVS-2 implements request creation, batch settlement, cancellation, expiry and fixed claim delivery. Both include immutable genesis, fee collection, reserve top-up and action-scoped pause. Each contract rejects the other family's unsupported modes and operations. Public wire tags and field order remain unchanged.

## Install and verify

Use Node.js **22.20** (the CI version), or a release matching `^22.13.0 || ^24.0.0 || >=26.0.0`, with **Aiken v1.1.22+39d6b04**, stdlib **v3.1.0**, fuzz **v2.2.0** and Plutus **V3**. Dependencies are pinned in one npm lockfile and each onchain project's Aiken lockfile. Install the compiler from its [upstream release](https://github.com/aiken-lang/aiken/releases/tag/v1.1.22).

From `reference/`:

```sh
npm ci --ignore-scripts
npm run check
```

Set `AIKEN=/absolute/path/to/aiken` if necessary. The complete check runs strict typechecking, Biome formatting/lint/import checks, Aiken formatting, Vitest unit/property tests with V8 coverage, both compiled Aiken suites and signed ledger integration tests. A [GitHub Actions workflow](../.github/workflows/reference.yml) runs the same gate and retains reports. Its configuration is checked in; no remote run is claimed by a local check.

## TypeScript formatting and linting

Biome **2.5.14** is installed by `npm ci` from the pinned workspace lockfile. The shared [ruleset](biome.json) applies to both clients, shared packages, tests and tools. Generated builds, artifacts, evidence, dependencies and the lockfile are excluded. The formatter uses two spaces, LF endings, double quotes, semicolons, trailing commas and a 100-column target.

| Command, from `reference/` | Purpose |
| --- | --- |
| `npm run format` | Apply formatting, including function spacing |
| `npm run format:check` | Check formatting without edits |
| `npm run lint` | Check lint rules; warnings fail |
| `npm run lint:fix` | Apply safe lint fixes |
| `npm run fix` | Apply formatting, import organization and safe lint fixes |
| `npm run check:typescript` | Strict TypeScript plus non-mutating formatting, lint and import checks |

A focused [ESLint Stylistic ruleset](eslint.config.js) requires blank lines around function declarations, exported functions, function-valued variables and class methods. It also separates declaration groups, guard checks, loops, try blocks and returns, while keeping consecutive variable declarations together. Biome preserves those blank lines. Both tools run in the format/fix commands and the non-mutating checks. ESLint uses the TypeScript parser; no second recommended lint preset is enabled.

Structural rules are errors: cyclomatic complexity must be at most 15, nesting depth at most 4, and functions at most 100 lines excluding blank lines and comments. They apply to tests and tools too. All 38 [initial findings](../docs/reviews/2026-09-18-structural-lint.md) are resolved under these unchanged limits; the [refactor record](../docs/reviews/2026-09-18-structural-refactor/README.md) retains the validation results.

`npm run check` and CI include `check:typescript`. The rules extend Biome's recommended preset and enforce unused-code checks, type-only imports, `node:` builtin imports, strict equality, no explicit `any`, no non-null assertions, no import cycles, no debugger statements and no focused or skipped tests. The [compiler configuration](tsconfig.json) also checks unused declarations, missing returns, unreachable code and unused labels alongside the existing strict/null/indexed-access checks.

The explicitly enabled [floating-Promise](https://biomejs.dev/linter/rules/no-floating-promises/) and [misused-Promise](https://biomejs.dev/linter/rules/no-misused-promises/) rules are experimental in this pinned Biome release. They supplement TypeScript and runtime tests; review their behavior when upgrading. Safe fix commands do not apply their unsafe fixes. Any suppression should explain a concrete exception on the affected line.

For VS Code or Cursor, open **`reference/` as the workspace folder** and install the recommended Biome and ESLint extensions. The checked-in `.vscode/` settings use the local toolchain, format on save, organize imports and apply safe fixes on explicit saves. `.editorconfig` supplies matching whitespace defaults for other editors. No global npm install or Git hooks are required.

Useful narrower commands:

```sh
npm run test                 # TypeScript unit and property tests
npm run test:coverage        # All production TS modules, including unimported files
npm run test:watch
npm run build:ctvs1
npm run build:ctvs2
npm run test:onchain         # Both families, reproducible property seeds
npm run test:integration     # Uses the previously built artifacts
```

To apply a built P template locally:

```sh
npm run apply -- --implementation ctvs1 --seed SEED_TX_HEX --output-index 0 --terms-hash TERMS_HASH_HEX
```

Use `ctvs2` for the asynchronous project. The two arguments bind the consumed genesis seed and exact immutable Terms commitment. This writes a blueprint and policy ID, without selecting a network or establishing that the seed exists.

## Code comments

Each authored code file explains its responsibility and relevant boundaries. Public APIs and substantial private helpers document their contracts: input assumptions, result meaning, mutation, failure behavior and the invariants that callers must preserve. Type and field comments explain units, signs, null states, authority and provenance when these are not obvious from their names.

Keep rationale beside the checks it explains: rounding, wire commitments, asset custody, execution order and local test assumptions. Test names already describe most assertions; comments should explain scenario setup, phase dependencies and what a rejection actually proves. Update these explanations when behavior changes, and avoid comments that merely repeat a name, type or statement.

## Organization

```text
implementations/
  ctvs1/{client,onchain}/    Synchronous API and independently compiled contract
  ctvs2/{client,onchain}/    Async API and independently compiled contracts
packages/
  protocol/src/{data,math,wire}/
                            Shared typed representation, economics and wire validation
  planning/src/             Transaction intents, values and shared maintenance planning
  cardano/src/              Complete wallet effects and measured resource selection
  integration/src/          Authenticated accepted-history reader and semantic responses
  onchain/                  Canonical shared Aiken predicates, types and properties
testing/
  fixtures/                 Isolated wallet, vault and request fixtures
  ledger/                   Lucid construction, complete effects, signed evaluation and records
  integration/{ctvs1,ctvs2}/ Family lifecycle and compiled rejection tests
tools/                      Compiler staging, builds, parameter application and checks
artifacts/                  Generated blueprints, coverage, raw CBOR and test reports
```

Shared primitives have one canonical source. The Aiken build merges that source and exactly one family into disposable `.build/{family}` staging, rejects collisions and symlinks, and generates only the support-script hash binding module. It never patches authored family sources. Build manifests record source hashes, compiler/library versions and final script identities. Mint and spend entrypoints must have identical applied P bytes and policy identity.

The packages are private source workspaces, consumed through their TypeScript exports. Publishing JavaScript distributions or npm releases is outside the current build.

## Dependencies and API boundaries

The client is strict TypeScript rather than `.mjs`. `@noble/hashes` supplies BLAKE2b-256; `@harmoniclabs/plutus-data` and `@harmoniclabs/cbor` supply Plutus Data objects and generic serialization. A small [protocol adapter](packages/protocol/README.md) enforces the whitepaper's map encoding, chunk bounds and legal tags. Protocol-specific validation and integer economics remain explicit reference code. There is no handwritten cryptographic primitive or generic CBOR byte parser.

The [CTVS-1 client](implementations/ctvs1/client/README.md) and [CTVS-2 client](implementations/ctvs2/client/README.md) produce typed transaction intents with `submitReady: false`. They make protected inputs, output indices, mint effects, bounds and signers reviewable. Funding selection, fees, collateral, network authentication and signing belong to a consuming ledger adapter. The [Cardano package](packages/cardano/README.md) verifies complete wallet effects and selects feasible request/Claim groups using real evaluation. The [integration package](packages/integration/README.md) authenticates discovery and lifecycle history from a trusted accepted-block feed, handles rollback, and supplies common responses. The local [testing adapter](testing/README.md) constructs and signs against pinned Lucid Evolution and an explicit Plutus evaluator.

Profile 0 covers direct custody, immutable Terms, key controllers and funded Claims. Managed NAV, script controllers, inventory shares, migration, cross-vault composition and terminal closure are outside this implementation's profile. Original V0 sketches and proposed ADRs elsewhere in the repository do not change this wire contract.
