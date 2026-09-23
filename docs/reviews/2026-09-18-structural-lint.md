# TypeScript structural lint baseline

Rules are enabled as errors: cyclomatic complexity 15, nesting depth 4, and function length 100 lines excluding blank lines and comments. This records the initial capture before refactoring.

Initial result: 38 diagnostics across 28 files. Complexity: 16; function length: 22; nesting depth: 0. ESLint exited 1 at this capture.

Resolved on 18 September 2026: zero ESLint diagnostics under the same rules, with no exemptions. See the [refactor and validation record](2026-09-18-structural-refactor/README.md). The table below retains the original findings and original line numbers.

Counts include nested callbacks and test suite containers. A function and its callback can both receive a length diagnostic; these are not counts of distinct maintenance problems.

| File | Line | Rule | Finding |
| --- | ---: | --- | --- |
| [reference/implementations/ctvs1/client/test/direct.property.test.ts](../../reference/implementations/ctvs1/client/test/direct.property.test.ts#L15) | 15 | `complexity` | Arrow function has a complexity of 22. Maximum allowed is 15. |
| [reference/implementations/ctvs1/client/test/direct.test.ts](../../reference/implementations/ctvs1/client/test/direct.test.ts#L16) | 16 | `max-lines-per-function` | Arrow function has too many lines (108). Maximum allowed is 100. |
| [reference/implementations/ctvs2/client/src/batch.ts](../../reference/implementations/ctvs2/client/src/batch.ts#L51) | 51 | `max-lines-per-function` | Function 'buildBatchPlan' has too many lines (111). Maximum allowed is 100. |
| [reference/implementations/ctvs2/client/test/requests-batch.test.ts](../../reference/implementations/ctvs2/client/test/requests-batch.test.ts#L71) | 71 | `max-lines-per-function` | Arrow function has too many lines (179). Maximum allowed is 100. |
| [reference/packages/cardano/src/effects-witnesses.ts](../../reference/packages/cardano/src/effects-witnesses.ts#L7) | 7 | `max-lines-per-function` | Function 'verifyWitnesses' has too many lines (101). Maximum allowed is 100. |
| [reference/packages/cardano/src/effects-witnesses.ts](../../reference/packages/cardano/src/effects-witnesses.ts#L17) | 17 | `complexity` | Arrow function has a complexity of 22. Maximum allowed is 15. |
| [reference/packages/cardano/src/effects.ts](../../reference/packages/cardano/src/effects.ts#L252) | 252 | `max-lines-per-function` | Function 'verifyTransactionEffects' has too many lines (156). Maximum allowed is 100. |
| [reference/packages/cardano/src/effects.ts](../../reference/packages/cardano/src/effects.ts#L273) | 273 | `max-lines-per-function` | Arrow function has too many lines (137). Maximum allowed is 100. |
| [reference/packages/cardano/src/effects.ts](../../reference/packages/cardano/src/effects.ts#L273) | 273 | `complexity` | Arrow function has a complexity of 29. Maximum allowed is 15. |
| [reference/packages/cardano/src/selection.ts](../../reference/packages/cardano/src/selection.ts#L91) | 91 | `max-lines-per-function` | Async function 'select' has too many lines (110). Maximum allowed is 100. |
| [reference/packages/cardano/src/selection.ts](../../reference/packages/cardano/src/selection.ts#L91) | 91 | `complexity` | Async function 'select' has a complexity of 18. Maximum allowed is 15. |
| [reference/packages/cardano/test/effects-fixtures.ts](../../reference/packages/cardano/test/effects-fixtures.ts#L17) | 17 | `max-lines-per-function` | Function 'effectsFixture' has too many lines (168). Maximum allowed is 100. |
| [reference/packages/cardano/test/effects-fixtures.ts](../../reference/packages/cardano/test/effects-fixtures.ts#L24) | 24 | `max-lines-per-function` | Arrow function has too many lines (160). Maximum allowed is 100. |
| [reference/packages/cardano/test/effects.test.ts](../../reference/packages/cardano/test/effects.test.ts#L19) | 19 | `max-lines-per-function` | Arrow function has too many lines (416). Maximum allowed is 100. |
| [reference/packages/cardano/test/selection.test.ts](../../reference/packages/cardano/test/selection.test.ts#L25) | 25 | `max-lines-per-function` | Arrow function has too many lines (166). Maximum allowed is 100. |
| [reference/packages/integration/src/identity.ts](../../reference/packages/integration/src/identity.ts#L18) | 18 | `complexity` | Function 'discoverGenesis' has a complexity of 21. Maximum allowed is 15. |
| [reference/packages/integration/src/project.ts](../../reference/packages/integration/src/project.ts#L46) | 46 | `complexity` | Function 'advanceState' has a complexity of 17. Maximum allowed is 15. |
| [reference/packages/integration/src/project.ts](../../reference/packages/integration/src/project.ts#L117) | 117 | `complexity` | Function 'projectTransaction' has a complexity of 29. Maximum allowed is 15. |
| [reference/packages/integration/src/reader.ts](../../reference/packages/integration/src/reader.ts#L288) | 288 | `complexity` | Method 'request' has a complexity of 16. Maximum allowed is 15. |
| [reference/packages/integration/src/reader.ts](../../reference/packages/integration/src/reader.ts#L413) | 413 | `complexity` | Method 'ownership' has a complexity of 20. Maximum allowed is 15. |
| [reference/packages/integration/src/reader.ts](../../reference/packages/integration/src/reader.ts#L481) | 481 | `complexity` | Method 'effects' has a complexity of 21. Maximum allowed is 15. |
| [reference/packages/integration/test/reader.test.ts](../../reference/packages/integration/test/reader.test.ts#L72) | 72 | `max-lines-per-function` | Arrow function has too many lines (208). Maximum allowed is 100. |
| [reference/packages/planning/src/plan.ts](../../reference/packages/planning/src/plan.ts#L116) | 116 | `complexity` | Function 'validatePlan' has a complexity of 27. Maximum allowed is 15. |
| [reference/packages/protocol/src/data/codec.ts](../../reference/packages/protocol/src/data/codec.ts#L95) | 95 | `complexity` | Function 'walk' has a complexity of 22. Maximum allowed is 15. |
| [reference/packages/protocol/src/data/value.ts](../../reference/packages/protocol/src/data/value.ts#L52) | 52 | `complexity` | Function 'equalData' has a complexity of 18. Maximum allowed is 15. |
| [reference/packages/protocol/src/data/value.ts](../../reference/packages/protocol/src/data/value.ts#L115) | 115 | `complexity` | Function 'dataFromJson' has a complexity of 21. Maximum allowed is 15. |
| [reference/packages/protocol/src/math/transition.ts](../../reference/packages/protocol/src/math/transition.ts#L18) | 18 | `complexity` | Function 'transition' has a complexity of 18. Maximum allowed is 15. |
| [reference/packages/protocol/tests/math.property.test.ts](../../reference/packages/protocol/tests/math.property.test.ts#L23) | 23 | `max-lines-per-function` | Arrow function has too many lines (102). Maximum allowed is 100. |
| [reference/packages/protocol/tests/math.test.ts](../../reference/packages/protocol/tests/math.test.ts#L23) | 23 | `max-lines-per-function` | Arrow function has too many lines (130). Maximum allowed is 100. |
| [reference/packages/protocol/tests/wire.test.ts](../../reference/packages/protocol/tests/wire.test.ts#L102) | 102 | `max-lines-per-function` | Arrow function has too many lines (156). Maximum allowed is 100. |
| [reference/packages/protocol/tests/wire.test.ts](../../reference/packages/protocol/tests/wire.test.ts#L324) | 324 | `max-lines-per-function` | Arrow function has too many lines (149). Maximum allowed is 100. |
| [reference/testing/fixtures/vault.ts](../../reference/testing/fixtures/vault.ts#L244) | 244 | `max-lines-per-function` | Async function 'createVault' has too many lines (154). Maximum allowed is 100. |
| [reference/testing/integration/ctvs1/lifecycle.test.ts](../../reference/testing/integration/ctvs1/lifecycle.test.ts#L31) | 31 | `max-lines-per-function` | Arrow function has too many lines (113). Maximum allowed is 100. |
| [reference/testing/integration/ctvs2/lifecycle.test.ts](../../reference/testing/integration/ctvs2/lifecycle.test.ts#L13) | 13 | `max-lines-per-function` | Arrow function has too many lines (111). Maximum allowed is 100. |
| [reference/testing/integration/ctvs2/reader.test.ts](../../reference/testing/integration/ctvs2/reader.test.ts#L13) | 13 | `max-lines-per-function` | Async arrow function has too many lines (267). Maximum allowed is 100. |
| [reference/testing/integration/ctvs2/selection.test.ts](../../reference/testing/integration/ctvs2/selection.test.ts#L10) | 10 | `max-lines-per-function` | Async arrow function has too many lines (176). Maximum allowed is 100. |
| [reference/testing/ledger/evaluator.test.ts](../../reference/testing/ledger/evaluator.test.ts#L117) | 117 | `max-lines-per-function` | Arrow function has too many lines (112). Maximum allowed is 100. |
| [reference/tools/check-onchain.ts](../../reference/tools/check-onchain.ts#L8) | 8 | `complexity` | Arrow function has a complexity of 19. Maximum allowed is 15. |
