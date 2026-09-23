# Reference validation record

## Latest verified run: structural refactor, 18 September 2026

All 38 structural lint findings are resolved across 28 TypeScript files. Cyclomatic complexity remains limited to 15, nesting to 4, and function length to 100 nonblank, noncomment lines. ESLint reports zero errors or warnings across 112 files, including tests and tools. No rule exemptions or dependencies were added.

The [refactor record](../docs/reviews/2026-09-18-structural-refactor/README.md), [validation data](../docs/reviews/2026-09-18-structural-refactor/validation.json) and [full gate log](../docs/reviews/2026-09-18-structural-refactor/check.log) retain the evidence.

| Layer | Result |
| --- | --- |
| TypeScript unit/property/harness | 312 passed |
| CTVS-1 Aiken | 85 passed: 76 unit, 9 property |
| CTVS-2 Aiken | 108 passed: 98 unit, 10 property |
| Integration | 31 passed: 29 signed local scenarios and 2 parameter checks |
| Production TS coverage | 98.87% lines, 97.51% statements, 94.15% branches, 97.99% functions |

The complete gate passed with `VITEST_MAX_WORKERS=4` and the pinned Aiken compiler. TypeScript checks and coverage passed again after an independent review correction preserved validation order for an empty mint list. All 196 test registrations and all 343 executed TypeScript/integration case names match the pre-refactor inventory; no tests were removed, skipped or marked todo. Property seeds, run counts and coverage thresholds are unchanged.

Helpers separate existing validation, construction and projection responsibilities. Onchain source, dependency locks and lint configuration are unchanged by this refactor. Coverage percentages reflect the changed source structure and are not a measure of additional protocol assurance. This remains local validation, without node-backed or public-network acceptance.

## Prior library reuse run: 18 September 2026

All check stages pass after replacing custom CML ownership and redeemer-format handling with Lucid/CML APIs and sharing canonical asset/reference conversions. The [validation record](../docs/reviews/2026-09-18-library-reuse/validation.json) and [run log](../docs/reviews/2026-09-18-library-reuse/check.log) bind these results to this working tree.

| Layer | Result |
| --- | --- |
| TypeScript unit/property/harness | 312 passed, including 24 new regressions |
| CTVS-1 Aiken | 85 passed: 76 unit, 9 property |
| CTVS-2 Aiken | 108 passed: 98 unit, 10 property |
| Integration | 31 passed: 29 signed local scenarios and 2 parameter checks |
| Production TS coverage | 98.71% lines, 97.48% statements, 94.24% branches, 97.77% functions |

The initial `npm run check` passed typechecking, lint and onchain formatting, then three existing property tests exceeded Vitest's five-second timeout. `npm run test:coverage -- --maxWorkers=4` passed the complete suite with unchanged seeds, case counts, timeouts and coverage thresholds. Both remaining stages, `npm run test:onchain` and `npm run test:integration`, then passed. Use `VITEST_MAX_WORKERS=4 npm run check` to reproduce the bounded worker setting with the pinned compiler configured.

The new regressions cover legacy/map redeemers, duplicate and out-of-range spend pointers, CIP-67 labels, signed burns, malformed assets, zero-valued aliases and canonical input-reference validation. No dependencies or onchain semantics changed. This remains local validation, not node-backed or public-network acceptance.

## Prior remediation run: 18 September 2026

The complete `npm run check` gate passes after the [five-finding remediation](../docs/reviews/2026-09-18-remediation/README.md). The [saved validation record](../docs/reviews/2026-09-18-remediation/validation.json) and [full gate log](../docs/reviews/2026-09-18-remediation/check.log) bind these results to this run.

| Layer | Result |
| --- | --- |
| TypeScript unit/property/harness | 288 passed |
| CTVS-1 Aiken | 85 passed: 76 unit, 9 property |
| CTVS-2 Aiken | 108 passed: 98 unit, 10 property |
| Integration | 31 passed: 29 signed local scenarios and 2 parameter checks |
| Production TS coverage | 98.20% lines, 96.69% statements, 93.59% branches, 97.76% functions |

Coverage now includes the new Cardano and integration packages. Thresholds remain unchanged. Shared Aiken checks run in both families and are not additive unique tests. Additional retained evidence covers raw recovery compatibility, full wallet effects, adaptive batching/delivery, authenticated reader provenance, ownership and local rollback/replacement histories. Node-backed acceptance/rollback, independent interoperability and public deployment remain unverified. Script identities and onchain semantics are unchanged.

## Historical baseline: 16 September 2026

The following dated record describes the earlier baseline. Its original compact evidence snapshot remains available; generated `artifacts/` reports now reflect the latest run.


Recorded local run: **16 September 2026**. Source: the supplied 85-page `CTVS-Whitepapers-v0.6.3-Illustrated-Combined.pdf`, semantic revision 0.6, wire integer 2, profile integer 0. The PDF identifies repository baseline `f5f782de9ba6a7bf6cbb8213995a31734888559c`.

PDF SHA-256: `e06e90a6eb2eb1e9ffdc90d38b7bcabd392b54b3144d78faf11c8be321054e75`.

The old V0 sketches and proposed ADRs have not been adopted as wire changes. The unavailable original `candidate-wire/` and REQ evidence bundle remains a separate reconciliation gate. Current vectors are preserved client fixtures and newly authored tests derived from the supplied PDF.

## Measured TypeScript coverage

The full production protocol and client source is included, even when a file is not imported by tests. Tooling, fixtures and the ledger test harness are excluded from this percentage and have their own tests.

| Metric | Covered / total | Coverage | Required |
| --- | --- | --- | --- |
| Statements | 879 / 885 | 99.32% | 90% |
| Branches | 690 / 701 | 98.43% | 85% |
| Functions | 174 / 174 | 100% | 90% |
| Lines | 784 / 787 | 99.61% | 90% |

Raw V8 output: `artifacts/coverage/coverage-summary.json`, `lcov.info` and the HTML report. **This is TypeScript source coverage, not Aiken coverage or a percentage of protocol safety requirements proved.**

## Test layers

| Layer | Recorded result | What it establishes |
| --- | --- | --- |
| TypeScript unit/property and harness regressions | 185 passing cases, including 7,550 generated fast-check examples across 11 properties | Wire and integer behavior, all public planners, adversarial serialization, signed-budget enforcement, protected-output preservation and staging integrity |
| CTVS-1 Aiken | 83 passing checks: 74 unit, 9 properties | Synchronous compiled handlers, shared predicates and generated economic/family bounds |
| CTVS-2 Aiken | 106 passing checks: 96 unit, 10 properties | Asynchronous compiled handlers, exhaustive settlement, recovery and Claim guards |
| Signed local integration | 26 passing lifecycle cases, both ADA and native backing | Actual construction, signatures, explicit final-CBOR Plutus execution, publication size, authenticated lifecycle and rejection cases |
| Parameter application integration | 2 passing cases, one per family | Independent CLI and Lucid agreement on applied policy hashes and normalized program bytes |

Shared Aiken checks intentionally run in both family projects. The family counts are not additive unique-test counts. The [test provenance map](packages/onchain/test-provenance.json) retains all 122 original named checks; the current source has 145 distinct named checks. Aiken uses seed `20260916`, 1,000 successes per property, and denies warnings. TypeScript uses the same fixed seed with explicit per-property run counts. No test is skipped or marked todo in the recorded run.

No Aiken source line/branch coverage is measured. Test-program budgets include fixture construction and are not transaction execution-unit budgets. Coverage alone does not prove a specification or establish security.

## Signed local evidence

CTVS-1 executes all four direct operations, fees, reserve top-up and pause transitions, with negative tests for minimum output, recipient changes, authority and paused entry.

CTVS-2 executes an authenticated deposit Request, Batch, funded Claim and Q delivery, then the corresponding redeem lifecycle, plus maintenance. Recovery tests use unsupported economic bodies, preserve surplus assets and exercise expiry from another wallet. Compiled guards reject changed Claim recipients, missing settler signatures and incomplete multi-Claim delivery; the complete two-Claim delivery succeeds.

Every protected output is compared at its prescribed index before signing. The harness checks actual key signatures and required witnesses. Every signed transaction with Plutus redeemers is re-evaluated from its final CBOR and resolved input context, with exact redeemer coverage, sufficient declared budgets and unchanged aggregate limits. Negative validator tests must reach the compiled evaluator.

| Family | P template bytes | Measured signed reference-script publication | Local limit |
| --- | --- | --- | --- |
| CTVS-1 | 12,018 | 12,351 bytes | 16,384 bytes |
| CTVS-2 | 15,938 | 16,271 bytes | 16,384 bytes |

The earlier combined-program size blocker is resolved by independent family entrypoints and narrower traversal logic. CTVS-2's measured publication has only 113 bytes of headroom. This is one concrete funded/signed publication shape; extra transaction content may exceed the limit. The wire's `max_batch = 16` is not an advertised capacity. Complete transaction limits remain 14,000,000 memory units and 10,000,000,000 steps in the saved local parameters.

Across the 26 signed scenarios, **124 transactions were accepted locally**, **86 final signed transactions passed explicit Plutus evaluation**, and **14 invalid candidates were rejected by compiled validators**. The other 38 accepted transactions perform key-only publication or funding. These transaction counts include fresh genesis/publication setup for isolated tests.

Per-scenario reports, transaction IDs, raw signed CBOR, fees, actual execution units and deployment bindings are written to `artifacts/integration/{family}/{underlying}/{scenario}/`. The [compact saved snapshot](evidence/2026-09-16.json) binds this record to the measured run. CLI parameter application is cross-checked against the same seed and Terms used by the local Lucid application.

This is explicit Plutus execution plus selected local Emulator checks. It is not full cardano-node phase-1 validation or public-network acceptance. Initial native-token balances are synthetic; their external minting policies are not tested. The GitHub Actions workflow has been configured, but a local pass is not evidence of a remote CI run.

## Whitepaper acceptance matrix

| Requirement | Current evidence | Remaining evidence |
| --- | --- | --- |
| S-01 genesis/identity | Authenticated seed, Config/State, coupled issuance, signed genesis and matching CLI/Lucid parameter application | Independent builder and cardano-node acceptance |
| S-02 terms/succession | Immutable commitments, family modes, exact State succession, reserves and maintenance in both implementations | Wider reachable-state/adversarial corpus and external review |
| S-03 supply | Direct mint/burn coupling; batch gross supply bounds and zero-net cases; signed request/settlement/delivery lineage | Whole-ledger reconciliation and independent construction |
| S-04 value partitions | ADA/native physical custody readbacks; exact outputs; authenticated Claims, fees, reserve preservation and surplus recovery | Independent ledger validation across longer traces |
| S-05 integer economics | Generated rounding, conservation, monotonicity, round-trip and overflow properties; independent TS/Aiken implementations | Externally authored vectors and formal treatment of complete state transitions |
| S-06 attribution | Exact destinations/datums; unique indices; exhaustive Request/Claim coverage; compiled recipient/coverage rejection | Broader balanced adversarial transaction corpus |
| S-07 authority | Explicit pause/controller/settler checks; actual signatures; different-wallet expiry; missing-settler rejection | Independent node-backed witness and purpose corpus |
| S-08 residual behavior | Last redemption preserves residual backing; no terminal close or sweep branch | Wider reachable-state and extension evidence |
| S-09 wire | Exact role decoders; byte/chunk/tag/arity bounds; alternate legal CBOR; preserved builtin Terms commitment fixture | Original source-bundle comparison and external decoder corpus |
| S-10 construction | Separate typed APIs and signed local builders for both complete lifecycles; final-CBOR evaluation and declared budget checks | Independent transaction builder and node-backed acceptance |
| S-11 resources | Both signed publication shapes fit unchanged local limits; per-transaction measurements retained | Measured batch capacity and verification against target network parameters |
| S-12 infrastructure | Explicit deployment/chain-point intent fields and local reference resolution | Authenticated indexing, rollback/replay and provenance service |

The table tracks S-01 through S-12. It does not invent or close REQ-01 through REQ-14 entries from the missing historical source bundle.

## Reproduce and extend

From `reference/`, install locked npm dependencies, set the pinned Aiken compiler on PATH or in `AIKEN`, then run `npm run check`. See the [testing guide](testing/README.md) for targeted commands, report paths and regression placement. Build manifests record source SHA-256 bindings, compiler and dependency versions, script hashes and sizes.

The remaining acceptance work is node-backed lifecycle execution, measured batch capacity, original-bundle reconciliation, independent construction, rollback-aware indexing and external review. No network deployment, public release, PR or commit is implied by this record.
