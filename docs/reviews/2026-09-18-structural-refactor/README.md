# Structural lint refactor

Resolved all 38 findings across 28 TypeScript files. ESLint now reports zero errors or warnings across 112 files. The existing limits remain complexity 15, depth 4 and function length 100, excluding blank lines and comments. No exemptions, dependencies or new implementation modules were added.

Production helpers now separate plan validation, Plutus Data validation, economic bounds, transaction input/witness checks, whole-group selection, batch output layout, genesis authentication and reader projection. Settlement still establishes Claim lineage before classifying consumed Requests; invalid transactions still use collateral-only ledger effects. Public APIs and onchain source remain unchanged.

Tests use smaller sibling suites with unchanged names. The long reader and resource-selection integrations remain single scenarios with typed phase helpers. Fixture setup, script publication and CML transaction construction have separate responsibilities. All 196 registrations and all 343 executed case names match the baseline. Property seeds, generated-case counts and assertions were retained.

| Check | Result |
| --- | --- |
| TypeScript, Biome, ESLint, Aiken formatting | Passed |
| TypeScript unit/property/harness | 312 passed |
| CTVS-1 Aiken | 85 passed |
| CTVS-2 Aiken | 108 passed |
| Signed local integration and parameter checks | 31 passed |
| Production TS coverage | 98.87% lines, 97.51% statements, 94.15% branches, 97.99% functions |

Independent review covered every production refactor. It identified an eager property read that changed validation order for empty mint lists; that was corrected. The full gate passed, and TypeScript checks plus coverage passed again after that correction. No remaining review findings were identified.

Evidence: [validation data](validation.json), [full gate log](check.log), [post-review TypeScript and coverage log](post-review.log), and [original lint baseline](../2026-09-18-structural-lint.md). The validation data binds the final authored `reference/` tree and unchanged case inventories by SHA-256.

Reproduce from `reference/` with the pinned compiler configured:

```sh
VITEST_MAX_WORKERS=4 AIKEN=/absolute/path/to/aiken npm run check
```

Aiken family totals include shared checks. Local evaluation does not establish node-backed or public-network acceptance. Coverage thresholds remain unchanged; percentages moved with the refactored source structure.
