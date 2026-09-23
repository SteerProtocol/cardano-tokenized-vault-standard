# Testing and contribution guide

Run the complete gate with `npm run check` from `reference/`. The workspace uses Vitest projects for unit, property and integration tests, fast-check for TypeScript properties, Aiken's native test/property runner for onchain code, V8 for measured TypeScript coverage, and Biome plus strict TypeScript for static checks.

For the static gate alone, run `npm run check:typescript`. It fails on formatting, import-order, lint or compiler violations without editing files. See the [formatting and linting commands](../README.md#typescript-formatting-and-linting) for safe local fixes and the shared ruleset.

## Test placement

- Protocol tests belong beside their package in `packages/protocol/tests/`.
- Cardano effects/selection and integration reader tests belong in their own package `test/` directories.
- Shared planning tests belong in `packages/planning/test/`.
- Each client owns its tests in `implementations/{family}/client/test/`.
- Shared Aiken test modules live in `packages/onchain`; family handler and lifecycle tests live inside that family's onchain project.
- Signed lifecycle and compiled rejection tests live in `testing/integration/{family}/`. Parameter application cross-checks live in `testing/integration/compilation/`.
- Tests of the test harness itself live in `testing/ledger/`. Build staging regressions live in `tools/lib/`.

Use `*.property.test.ts` for generated properties. New economic or wire behavior needs observable invariants, boundary cases and malformed-input examples. A validator fix needs a compiled rejection case and, when transaction construction matters, a signed lifecycle regression. Avoid tests that merely duplicate an implementation formula.

## Coverage and reproducibility

The coverage include patterns name **every production TypeScript file** in shared packages and both clients, including files not imported by tests. Gates require at least **90% lines, statements and functions**, and **85% branches**. Harness/tool coverage is outside this percentage; those components have explicit regressions and signed integration tests. Aiken does not provide comparable source line/branch coverage in this workflow. Its passing test counts and generated cases are reported separately.

```sh
npm run test:coverage
npx vitest run --project unit packages/protocol/tests/wire.test.ts
npx vitest run --project property implementations/ctvs2/client
npm run test:onchain -- ctvs2
npx vitest run --project integration testing/integration/ctvs2
```

V8 outputs HTML, LCOV and JSON summaries to `artifacts/coverage/`. Vitest writes JUnit reports to `artifacts/test-results/`. Aiken writes raw JSON and stderr per family, with seed `20260916` and 1,000 successful cases per property. Fast-check properties use explicit source-controlled seeds and run counts; replay its reported seed and path in the affected property when diagnosing a failure. Do not reduce thresholds or add skips to conceal regressions.

## Signed transaction harness

`fixtures/vault.ts` loads a built family blueprint, applies its actual genesis seed and Terms, publishes P, and creates authenticated Config and State. ADA/native fixtures use isolated generated wallets. `fixtures/requests.ts` exercises real Request to Batch to funded Claim to delivery lineage.

`ledger/builder.ts` consumes the public SDK's `TransactionPlan`. It resolves actual local UTxOs and preserves protected output order while Lucid handles funding, fees, change and collateral. Before construction, the fixture fixes an explicit wallet authorization. Before signing, `@ctvs/cardano` verifies every body effect, including funding/change, fees, collateral, mint, redeemers, scripts and validity, then binds the signed body to that approval. The narrow `ledger/outputs.ts` helper remains a protected-output assertion for its focused regression tests. An automatic minimum-ADA adjustment is a construction failure requiring explicit replanning.

`ledger/evaluator.ts` evaluates compiled Plutus using pinned WASM, actual serialized transaction CBOR, resolved inputs, cost models and slot configuration. Final signed bytes are evaluated again. The harness checks exact redeemer purpose/index coverage, declared per-redeemer execution budgets and aggregate limits. It rejects script-bearing transactions without evaluation context.

`ledger/recorder.ts` checks actual key signatures, required witnesses and the 16,384-byte transaction ceiling, submits to the local Emulator and saves the result. Successful State transitions are read back and compared with the plan. Negative compiled tests must reach the actual Plutus evaluator; a builder-only error does not count as validator rejection.

Each scenario writes `artifacts/integration/{family}/{underlying}/{scenario}/report.json`, raw signed CBOR, transaction IDs, execution records and source-bound deployment evidence. Fixtures use the unchanged Emulator limits of 14,000,000 memory units and 10,000,000,000 steps. Synthetic initial native balances do not test an external asset's minting policy. Random ephemeral private keys are never saved in evidence.

These checks establish local construction, cryptographic witness checks and explicit Plutus execution. They do not substitute for full cardano-node phase-1 validation, public-testnet acceptance, node-backed rollback or an independent audit. The integration reader now has a separate retained signed-history replay and replacement-branch test; its synthetic local block points are not node evidence. A measured publication transaction does not establish maximum batch capacity.

`ledger/selection.ts` completes and evaluates candidates using the actual configured limits. The retained eight-Request/eight-Claim integration case exercises adaptive splits and fresh-State rebuilding. Its chosen counts are observations, not protocol constants.
