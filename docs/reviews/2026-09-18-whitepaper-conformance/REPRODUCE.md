# Reproduce the conformance review evidence

These commands run locally. They do not submit to a public network. They create fresh ephemeral Emulator wallets and overwrite only generated local evidence/scenario artifacts. Transaction IDs and exact resource measurements may differ when regenerated because some wallet identities and input ordering vary. A rerun establishes a new sample; it must not be silently substituted into the dated report tables.

Use the repository's installed locked dependencies, a supported Node version and the pinned Aiken compiler (`v1.1.22+39d6b04`). The recorded environment used Node `v26.7.0`, npm `11.19.0`, Aiken stdlib `v3.1.0` and fuzz `v2.2.0`. The baseline manifest binds the exact source revision and PDF hash.

## Baseline

From `reference/`:

```sh
export AIKEN=/absolute/path/to/pinned/aiken
npm run check
```

The recorded command used `/tmp/ctvs-reference/aiken-aarch64-apple-darwin/aiken`. `npm run check` executes typechecking, lint, Aiken formatting, TS coverage, both Aiken family suites and signed local integration. It also builds the source-bound blueprints and cached dependencies required by the isolated handler probes.

The checked-in baseline summary is an observation from the review run, not an assertion that a future run still passes. Compare the complete exit status, source binding and generated output before updating it.

## Pure TypeScript and byte probes

From `reference/`:

```sh
node --import tsx ../docs/reviews/2026-09-18-whitepaper-conformance/probes/c1-economics.ts
node --import tsx ../docs/reviews/2026-09-18-whitepaper-conformance/probes/c2-client-boundaries.ts
node --import tsx ../docs/reviews/2026-09-18-whitepaper-conformance/probes/c2-semantic-examples.ts
node --import tsx ../docs/reviews/2026-09-18-whitepaper-conformance/probes/wire-client-probe.mjs
```

- `c1-economics.ts` compares independently expressed paper equations and expected transition acceptance with production functions. It also exercises bounded exhaustive maxima, upper-domain cases, conversion invariance, adjusted-price behavior and immediate round trips. This is finite model evidence, not a reachable-history or formal proof.
- `c2-client-boundaries.ts` asserts the observed SDK restrictions. It expects the uppercase-key and staked-Q rejections, so a future repair should deliberately update these expectations and add permanent regressions in the owning package.
- `c2-semantic-examples.ts` reproduces the paper's supplied mixed-batch/economic-history examples and eight direction/pause combinations. The supplied example States are not automatically authenticated reachable ledger States.
- `wire-client-probe.mjs` preserves the exact compact Request CBOR examples, checks independent CML decoding, records current SDK rejection, and runs arity/domain/commitment probes. It reports observations, including expected rejections; a zero exit code alone is not proof that all inputs were accepted.

Some probes write adjacent JSON results; the CTVS-2 probes print JSON and their retained `.result.json` files are captured output. Keep command output and inspect the actual observations, not only process status.

## Isolated compiled handler probes

From the repository root, after the baseline build:

```sh
python3 docs/reviews/2026-09-18-whitepaper-conformance/probes/c1-run-onchain.py
python3 docs/reviews/2026-09-18-whitepaper-conformance/probes/wire-run-onchain.py
```

The scripts expose their compiler path and staging assumptions. They copy shared/family sources and pinned cached dependencies into a temporary directory, add only the review test module, and run only that module. They read generated support-script bindings from the existing build and do not modify canonical implementation sources or shared `.build` staging.

The direct probe runs 16 cases against compiled source predicates. The wire probe runs two cancellation cases through the actual vault spending handler. These are Aiken test contexts, not final signed transactions. Their test-program execution units must not be reported as transaction budgets.

## Signed local transaction experiments

From `reference/`, after building both families:

```sh
node --import tsx ../docs/reviews/2026-09-18-whitepaper-conformance/probes/integration-probes.ts
node --import tsx ../docs/reviews/2026-09-18-whitepaper-conformance/probes/delivery-capacity.ts
```

The first script reproduces the unplanned extra-wallet-output observation, then settles homogeneous deposit batches across four asset/recipient shapes. It tests powers of two until the first failure and refines that interval. The recorded run tried 1, 2, 4, 5, 6, 7 and 8 for each shape. It did not try 3 or 16 for Batch.

The second script creates authentic Claims through batches of at most four, then tries delivery sizes 1, 4, 5, 6, 7, 8 and 16 for two recipient shapes. It uses the current test adapter's inline Q attachment. These are samples, not a worst-case search or universal maximum.

Success requires construction, exact protected outputs, actual key signatures, explicit final signed Plutus evaluation and local Emulator acceptance. Failure records distinguish compiled budget failures from builder failures. Local Emulator acceptance still does not establish cardano-node phase-1 acceptance or target-network feasibility.

Summary observations are retained under `evidence/`. Detailed transaction bytes, resolved inputs and execution records are generated under `reference/artifacts/integration/.../review-*`. The dated evidence manifest hashes generated files and review sources where available. Private keys are not written to those reports.

## Review integrity

Run the review inventory checker after all four requirement ledgers are present:

```sh
python3 docs/reviews/2026-09-18-whitepaper-conformance/probes/assemble-review.py
```

This validates required fields, IDs, page ranges and existing source line anchors, merges the ledgers into CSV/JSON, records inventory counts, and checks local Markdown link targets. It does not determine semantic correctness or turn source alignment into proof.
