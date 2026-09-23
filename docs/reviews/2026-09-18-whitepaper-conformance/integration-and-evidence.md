# Integration and acceptance evidence review

The implementation provides useful arithmetic primitives, transaction intents and local construction tests. It does not yet provide the authenticated integration boundary required by CTVS-1 section 13 and CTVS-2 sections 12.6-12.7. This is a missing implementation layer, not something high source coverage can establish.

The atomic records for this part are in [integration.requirements.json](integration.requirements.json). The source is the supplied v0.6.3 PDF, especially combined PDF pages 37-41 and 77-83. Page numbers below refer to that combined PDF.

## What the current boundary actually guarantees

`Context` contains a caller-supplied deployment, Terms and sometimes a State input. `assertContext` checks family, modes, field shapes, network-domain equality, commitment equality and supplied identifiers. It does not resolve genesis or authenticate a chain history. The comment in `packages/planning/src/types.ts:8` says this explicitly.

Public clients produce `CTVS-REFERENCE-PLAN-1` intents. They preserve protected outputs, action bounds, mint effects and required signers. They explicitly leave funding, change, network fee, collateral and final construction unresolved. An internal planning format is useful and need not itself be the standard response format. The missing part is the adapter and verified source layer that would expose the required common response semantics.

The test adapter resolves local UTxOs and uses Lucid to construct transactions. It is fixed to the local `Custom` network address construction. It checks protected outputs, signs with ephemeral wallets, checks signatures, evaluates final signed Plutus transactions and submits to a local Emulator. None of those actions implements share-to-vault discovery, verified network selection or a rollback-aware indexer.

## Missing semantic responses

| Response | Existing building blocks | Missing implementation |
| --- | --- | --- |
| Every response | Family, WIRE/profile, build ID, policy/Terms identities, supplied network/chain point | Complete standard envelope, claimed conformance, evidence references and verification disposition |
| Snapshot | State fields, Terms and exact value partition helpers | Authenticated source resolution, coherent snapshot, liquidity/capability/status response and share-to-vault discovery |
| Quote | Exact integer `preview`, direct-plan effects, Batch pricing State reference | Complete quote envelope with source evidence, minimum/maximum and construction-limit distinctions, prerequisites, expiry and common fee categories |
| Request/Claim | Raw wire records, recovery/settlement/delivery planners, participation labels | Lifecycle read API, authenticated origin, settled versus indicative values, complete recovery availability explanations and current ownership buckets |
| Constructed effects | Protected outputs, mint, signer/interval intent, local constructed bytes | Verified final funding/change/fees/collateral effects and user approval binding |
| Realized history | Local scenario transaction artifacts | Public accepted-result records and reversible settlement/delivery projections |

No particular HTTP transport, hosted service, ERC-style ABI or generic adapter platform is required. Missing named `maxMint` or `maxRedeem` functions are not by themselves the finding. The finding is that the required economic/availability information and evidence cannot yet be obtained through one complete common semantic boundary.

## Executed pre-signing counterexample

The review created an isolated CTVS-1 vault in the local Emulator, built an ordinary deposit plan and then appended a payment of **50,000,000 lovelace to a separate generated wallet** to the concrete transaction builder. Both planned protected outputs remained unchanged. `TransactionRecorder.submit` signed and accepted the transaction.

This demonstrates that `assertProtectedOutputs` is deliberately narrower than complete user-intent verification. It verifies the output indices listed in the plan, not all effects on the funding wallet. The extra payment did not violate the vault's accounting and did not take backing from the vault. It used additional wallet funding. The public intent also correctly says its funding and change are unresolved.

The finding is therefore **a gap that must be closed before this testing adapter is reused as a wallet-facing verified builder**, not a claim of an onchain theft vulnerability. The paper's section 13.4 requires the wider check before signing.

Reproduction: [integration-probes.ts](probes/integration-probes.ts). Observation: [integration-probes.json](evidence/integration-probes.json), `probe=unplanned-output`. Relevant source: `reference/testing/ledger/outputs.ts:8`, `recorder.ts:44`, and `reference/packages/planning/src/plan.ts:87`.

## Fresh baseline validation

The complete existing `npm run check` gate passed on the reviewed source revision. Raw output and environment/source bindings are in [baseline-check.log](evidence/baseline-check.log) and [baseline-summary.json](evidence/baseline-summary.json).

| Layer | Fresh result | Interpretation |
| --- | --- | --- |
| TypeScript unit/property/harness checks | 185 passed, zero failed or pending | Existing test suite still passes, including the previously retained property runs |
| CTVS-1 Aiken | 83 passed: 74 unit and 9 property | Shared and family checks compile and pass |
| CTVS-2 Aiken | 106 passed: 96 unit and 10 property | Shared and family checks compile and pass |
| Signed local integration | 26 lifecycle scenarios passed | Local transactions, actual key signatures and explicit Plutus execution |
| Parameter-only integration | 2 passed | CLI/Lucid parameter application agrees; not a second transaction builder |
| Production TypeScript V8 coverage | 99.61% lines, 99.32% statements, 98.43% branches, 100% functions | Includes production protocol/client/planning TS; excludes harness/tooling and Aiken source coverage |

The two Aiken totals overlap on shared tests. They are not 189 unique requirements. The TypeScript coverage percentage is not a measure of specification coverage. The new review probes live outside the existing suite and have their own result records; they have not been added to CI or included in those 185 tests.

## Acceptance matrix: CTVS-1 S-01 through S-12

This matrix tracks evidence obligations, not implementation percentages. A source-aligned requirement can still have an open acceptance gate.

| Paper ID | Obligation | Evidence now present | What remains open |
| --- | --- | --- | --- |
| S-01 | Authenticated genesis and identity | Compiled genesis checks, local signed genesis and parameter-application agreement | Independent construction and full ledger acceptance; original build/wire reconciliation |
| S-02 | Immutable Terms and State succession | Branch/source checks, positive/negative Aiken contexts, direct/async local successors | Complete adversarial real-transaction branch matrix and refinement evidence |
| S-03 | Economic and native supply | Direct mint/burn and async gross/net checks, zero-net source tests and signed individual lifecycles | Signed zero-net mixed trace, alternate-burn and whole-history independent reconciliation |
| S-04 | Closed value partitions | ADA/native tests, fees/reserves/top-ups, complete-value recovery and delivery | Wider independently generated balanced adversarial corpus and longer ledger histories |
| S-05 | Integer quotes and bounds | Existing generated properties plus fresh independent equation and boundary probes | External mathematical vectors and unbounded/formal transition treatment |
| S-06 | Complete payment attribution | Explicit indices, source tests for reuse/coverage, signed recipient/Claim-coverage rejection | Full same-destination, overlap, cross-vault and balanced-theft real-transaction matrix |
| S-07 | Actual authority | Real key signatures and required-signatory checks, signed missing-authority rejection | Finite-set/multi-key node-backed authority matrix; capability extension is not claimed |
| S-08 | Residual and insolvency behavior | Explicit residual/no-sweep logic and source tests | Longer reachable bootstrap/residual histories; managed insolvency is outside profile 0 |
| S-09 | Wire interoperability | TS/Aiken schemas, commitment fixture, legal CBOR tests, fresh CML and arity probes | Original golden bundle, broad independent external decoder corpus; recovery SDK discrepancy must be resolved |
| S-10 | Reproducible construction | One local Lucid builder, full local signed bytes and evaluation | A separate complete builder and cardano-node acceptance |
| S-11 | Bounded resources | Publication measurements, execution budgets, fresh batch and delivery experiments | Worst-case/target-network matrix and production construction limits; structural caps are not capacities |
| S-12 | Reliable infrastructure | Intent identifiers and local known-lineage fixtures | Authenticated reader, provenance indexer, coherent snapshots and rollback replay |

## Acceptance matrix: CTVS-2 A-01 through A-15

| Paper ID | Obligation | Evidence now present | What remains open |
| --- | --- | --- | --- |
| A-01 | Independent request creation | The stated local obligation is exercised: multiple requests are created without consuming State | Target-node confirmation is additional environment evidence; concurrent submission is useful operational testing, not an extra semantic prerequisite invented for A-01 |
| A-02 | Request value and intent | Exact partitions and strict settlement validation; malformed economics recovery tested | Broader ledger-created malformed/oversized candidates and recovery-resource cases |
| A-03 | Controllers | Controller-required cancellation and permissionless expiry, including a different wallet | Full node-backed witness/domain matrix; script controllers are an extension |
| A-04 | Full-only exhaustive settlement | Gross obligations, exact coverage and acknowledgments checked in source/tests | Complete signed omitted/duplicate/wrong-branch/no-remainder matrix |
| A-05 | One snapshot | Shared pre-State pricing, paper mixed example reproduced by SDK, per-request rounding | Independently constructed signed mixed-batch/wrong-basis corpus |
| A-06 | Economic/supply conservation | Gross issuance/burn and zero-net source tests, fresh paper economic-history probes | Signed zero-net mixed history and independent whole-ledger supply reconciliation |
| A-07 | Complete allocation | Disjoint indexed outputs, two-Claim signed rejection and delivery success | Larger adversarial same-receiver/reused-index/reserve-overlap signed cases |
| A-08 | Fully funded immutable Claims | Actual Claims from settlement, exact creation, surplus preservation and no delivery repricing | Broad independent wrong-asset/quantity/datum signed corpus |
| A-09 | Cancellation and expiry | Unsupported economics, exact interval source predicates, signed cancellation and expiry | Competing cancel/settle races and complete interval-boundary node histories |
| A-10 | Permissioned settlement without discretion | Explicit required settler signature, key-set predicates and a signed economically invalid recipient mutation under AnySettler | Finite-KeySet authorized-but-economically-invalid and unauthorized-key signed cases under node validation |
| A-11 | Independent fixed delivery | No live State required, signed key/script512 delivery and multi-Claim list checks | Signed delivery by a distinct third party with original controller/settler keys absent; wider staking/datum/adversarial and funded-look-alike corpus; SDK address restriction remains |
| A-12 | Coherent managed NAV/liabilities | Not implemented or advertised in profile 0 | Separate managed-profile requirement, not a missing direct-custody feature |
| A-13 | Rollback-aware lifecycle | No implementation | Settlement rollback, delivery-only rollback and competing branch replay |
| A-14 | Bounded execution | Fresh increasing batch and delivery samples reveal limits below structural caps | Worst-case outputs/integers/witnesses/asset sets and target-network verification |
| A-15 | Independent interoperability | Parameter-only CLI/Lucid cross-check and limited independent decoding | Two complete builders, independent indexers and external history agreement |

## Required test additions versus review-only evidence

The retained suite still lacks permanent regressions for the newly reproduced recovery-decoder incompatibility and authorized-key spelling issue. The review probes establish the observations but are not a substitute for adding those cases to the owning packages when fixes are made.

Other important gaps are complete cancel/settle race histories, real rollback, full directional pause/authority/destination matrices, finite settler sets in signed traces, signed zero-net mixed settlement, resource selection under heterogeneous requests, and independent historical decoding/construction. Source inspection or an isolated handler context cannot close these ledger/infrastructure gates.

The paper's historical statement that compiled-validator gates remained blocked was true of its publication evidence. It is now older than this implementation: compiled suites and selected local signed traces do exist and pass. Full node, network, independent-integration and release gates remain open. That is an evidence-status update, not a correction to an accounting equation.
