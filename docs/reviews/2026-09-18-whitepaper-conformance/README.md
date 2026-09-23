# Whitepaper versus implementation: methodical conformance review

**Reviewed on 18 September 2026.** Source revision: `75d47c90361d6f83458841b871e0f746500610e0`. Source document: `CTVS-Whitepapers-v0.6.3-Illustrated-Combined.pdf`, 85 pages, SHA-256 `e06e90a6eb2eb1e9ffdc90d38b7bcabd392b54b3144d78faf11c8be321054e75`.

The core direct-custody accounting paths matched the reviewed equations and targeted guard checks. However, this deeper pass found **reproducible SDK discrepancies**, substantial missing common integration functionality, and practical transaction limits below the wire's structural caps. It also establishes much more local execution evidence than the paper's historical publication baseline. These are different conclusions and must not be collapsed into a single conformance badge.

The work changed review documents and isolated probes only. Production contracts, clients, retained tests and the existing `LIMITATIONS.MD` were not changed. The existing full validation gate was rerun. No network transactions, deployment, commit or publication was performed.

## Review method and boundaries

1. Pin the exact PDF and source commit. Distinguish semantic revision 0.6, illustrated revision 0.6.3, WIRE 2, profile 0, compiled script identities and evidence revisions.
2. Read the substantive sections of both papers. Separate common requirements, exact profile-0 requirements, extension requirements, acceptance gates, examples and historical publication claims.
3. Decompose the requirements into traceable review rows. Each row identifies paper section/page, applicability, implementation location, specific retained test evidence, status, impact and a closure action.
4. Review actual code and test bodies. A test title is not accepted as proof that every behavior in its title is exercised. Shared tests are not counted twice as distinct requirements.
5. Rerun the full baseline gate, then execute focused counterexamples and independent equation/resource probes. Use isolated copied-source Aiken projects for additional handler tests, leaving production sources and shared build staging unchanged.
6. Reconcile findings across the direct, async, wire/identity and integration reviews. Keep source alignment, an executed handler context, a signed local transaction and a real-node acceptance result distinct.

The inventory is deliberately detailed but is not a proof that every possible transaction or semantic interpretation has been covered. Some rows overlap because a common obligation is enforced in several paths. Counts are review inventory, not a percentage of safety or standard conformance.

The finished inventory has **272 traceable rows**: 76 for CTVS-1, 109 for CTVS-2, 48 for shared wire/identity and 39 for integration/evidence. Its source/test anchors and local links are checked by the [inventory validator](evidence/inventory-check.json). The acceptance appendix separately addresses all 12 S requirements and all 15 A requirements.

| Paper coverage | Review location |
| --- | --- |
| CTVS-1 sections 1-3, 5-9 and 12 | Direct/economic review, including authority, examples and conditional proof premises |
| CTVS-1 section 4 and section 10 | Shared identity/genesis/wire review, with succession/terminal behavior also traced in the direct review |
| CTVS-1 section 11 | Explicit extension boundaries in wire/integration reviews |
| CTVS-1 sections 13-15 | Common integration, resource experiments and S-01 through S-12 acceptance evidence |
| CTVS-2 sections 1-9 and 13 | Async review of ownership, authority, settlement, recovery, examples and conditional proof premises |
| CTVS-2 sections 10-11 | Explicit managed/deferred-extension boundaries |
| CTVS-2 section 12 | Shared wire review for 12.1-12.5; common integration review for 12.6-12.7 |
| CTVS-2 sections 14-15 | Resource experiments and A-01 through A-15 acceptance evidence |
| Front matter, figure index, section 16 references | Context and source location, not additional executable requirements; cited third-party protocols were not audited |

### Status meanings

| Status | Meaning |
| --- | --- |
| `aligned` | No discrepancy found at the stated source/test boundary; additional ledger or independent proof may remain |
| `partial` | Some required behavior exists but the complete requirement or evidence is missing |
| `missing` | No implementation of the scoped required surface was found |
| `narrowed` | The artifact or client supports a smaller declared set of configurations/inputs than the paper or validator |
| `contradiction` | A concrete behavior differs from the reviewed requirement or equivalent accepted byte semantics |
| `unverified` | The conclusion depends on unavailable evidence or an external acceptance gate |
| `out_of_scope` | An explicitly separate extension is not claimed by this profile |
| `ambiguous` | Interpretation must be resolved before a conformance conclusion can be made |

### Navigation

- [Complete requirement inventory](requirements.csv) and [JSON inventory](requirements.json).
- [CTVS-1 economics and direct execution](ctvs1.md).
- [CTVS-2 requests, settlement, recovery and delivery](ctvs2.md).
- [Wire, identity, genesis and deployment binding](wire-identity.md).
- [Common integration and all S/A acceptance gates](integration-and-evidence.md).
- [Fresh baseline and source bindings](evidence/baseline-summary.json).
- [Reproduction instructions](REPRODUCE.md).

## Findings that change the earlier assessment

| ID | Finding | Classification | Practical consequence |
| --- | --- | --- | --- |
| F-01 | Valid recovery envelopes can be blocked by the SDK's generic decoding of unsupported economics | Reproduced client/contract discrepancy | The ordinary/default raw-data path fails; the depth limit is configurable, while the constructor representation limit is not |
| F-02 | Settler membership compares case-sensitive strings after accepting equivalent hexadecimal credential bytes | Reproduced client inconsistency | An authorized settler can be falsely reported unauthorized |
| F-03 | The signing harness verifies only listed protected outputs, not complete approved wallet effects | Partial required integration behavior | It must not be reused as a complete wallet-intent verifier |
| F-04 | Common snapshots/quotes/lifecycle responses, authenticated discovery and rollback indexing are missing | Missing required integration layer | The reference cannot yet provide the paper's complete verifiable integration boundary |
| F-05 | Tested batch and Claim-delivery shapes hit limits well below 16 | New resource evidence | Builders need shape/parameter-aware selection; a structurally valid intent is not necessarily constructible |
| F-06 | Only direct-only and async-only families are built | Disclosed configuration subset | No hybrid vault can be deployed from these artifacts |
| F-07 | CTVS-1 omits the general construction's Claim guard binding | Deployment specialization | Exact reference-construction claims need to describe this variant explicitly |
| F-08 | Delivery address and refund/delivery top-up options are narrower in the SDK | Smaller client capability gaps | Some guard-permitted transactions require a lower-level builder or manual plan changes |
| F-09 | Original source/schema bundle and independent integration evidence remain unavailable | Evidence gate | PDF-derived agreement cannot certify historical byte-for-byte or independent interoperability |

### F-01: SDK decoding defeats part of the intended recovery separation

The paper deliberately separates a supported recovery envelope from an uninterpreted economic body. CTVS-1 section 10.7 and CTVS-2 sections 4.2, 8.1 and 12.2 require supported cancellation/refund to remain available for unsupported economics. Recipient-datum limits are not supposed to become prerequisites for interpreting that economic body before recovery dispatch.

Two compact examples were reproduced:

| Economic body in an otherwise supported Request | Total Request CBOR | Independent CML decoder | SDK default raw decode | Actual compiled cancellation handler |
| --- | --- | --- | --- | --- |
| `Constr(9007199254740992, [])` | 144 bytes | Accepts | Rejects: constructor exceeds safe integer | Accepts balanced handler context |
| List nesting of depth 65 | 197 bytes | Accepts | Rejects: structural decoding budget | Accepts balanced handler context |

The SDK represents constructor alternatives with JavaScript `number` and eagerly decodes the full generic Data tree. Therefore `requestRecoveryFromData` never gets a chance to ignore these economic bodies on the default raw-data path. The onchain branch correctly preserves the untyped body and accepts cancellation. The nesting case has an existing workaround: `decodeData(raw, { maxDepth: 128 })` followed by recovery projection succeeds. The constructor-alternative failure remains with that override. The two cases must not be treated as equally unconfigurable defects.

This is **not evidence that the contracts trap these funds**. It is a mismatch in the shipped client recovery path. Nor do the compiled handler probes establish a fully signed cardano-node transaction for these exact CBOR examples. They establish source-handler acceptance; independent CML decoding establishes representability of the small encodings.

A fix should handle constructor alternatives without unsafe numeric narrowing. A recovery-specific raw-data path that validates the outer envelope while preserving/skipping the economic body would also avoid unnecessary eager decoding. Keep deliberate parsing/resource limits and document the existing depth override; do not confuse a default resource limit with an onchain loss of recovery rights. Retain both examples and the override control as owning-package regressions.

Evidence: [wire-client-probe.json](probes/wire-client-probe.json), [wire-onchain-results.json](probes/wire-onchain-results.json), and the [wire review](wire-identity.md).

### F-02: equal key bytes have unequal client authorization results

`buildBatchPlan` validates the reward key as a credential, then checks `terms.settlers.includes(rewardKey)`. The credential encoder accepts lowercase and uppercase spellings as identical bytes, while the membership test is case-sensitive. A lowercased authorized key succeeds; its uppercase spelling fails with `unauthorized settler`.

The validator checks byte-array equality. This does not give an unauthorized key access. It rejects an authorized input representation inconsistently. Normalize at the public boundary or compare decoded bytes consistently across identity checks, then retain an exact regression.

Evidence: [c2-client-boundaries.ts](probes/c2-client-boundaries.ts), [recorded observations](probes/c2-client-boundaries.result.json), requirement `C2-006`; source `reference/implementations/ctvs2/client/src/batch.ts:54`.

### F-03: protected-output checks do not verify the whole wallet action

A fresh local probe created a valid deposit plan and appended an unplanned payment of **50 ADA to a separate generated wallet** in the concrete builder. The harness preserved the two protected outputs, signed the transaction and accepted it locally.

The vault equations remained satisfied. The extra payment came from wallet funding, which the intent explicitly leaves unresolved. This is a concrete demonstration that the harness is a protected-output checker and local execution adapter, not the complete pre-signing verifier described in CTVS-1 section 13.4. Closing it requires a final approved-effects object and checks over funding, change, fees, collateral and every permitted extra effect before signing.

Evidence: [integration-probes.json](evidence/integration-probes.json), `unplanned-output`; source `reference/testing/ledger/outputs.ts:8` and `recorder.ts:44`. Full interpretation is in [integration-and-evidence.md](integration-and-evidence.md).

### F-04: the common integration contract is substantially unimplemented

The paper requires `CTVS-INTEGRATION-0.6` semantics regardless of API transport. Current clients expose an internal `CTVS-REFERENCE-PLAN-1` format and arithmetic previews. An internal intent format is not itself a violation. The missing piece is the verified adapter and source resolution that would turn those primitives into standard responses.

Specifically absent or incomplete:

- Verified share-to-vault discovery and authentication of deployment, genesis, Terms and State at one chain point.
- Complete snapshot, quote, limit, availability, fee-classification and verification-disposition responses.
- Explicit bootstrap/residual display status, economic minimum reporting and complete operation-limit semantics.
- Request/Claim lifecycle inspection, actual funded-claim provenance and separation of estimated versus realized output.
- Reversible ownership quantities and statuses across settlement rollback, delivery-only rollback and competing histories.
- Public construction that resolves and verifies the complete final wallet effects.

This is the largest functional gap against the whole standard. It is separate from whether the contracts enforce their selected profile correctly. The original schema file is also absent from the inspected publication material, so exact schema reconciliation remains an evidence gate.

### F-05: measured resource behavior

Parameters were unchanged from the local fixtures: 16,384-byte transaction limit, 14,000,000 memory units and 10,000,000,000 steps. The probes used actual constructed transactions and final signed evaluation for successful cases. Failed cases distinguish evaluator failures from construction size failures. No network capacity is inferred.

**Batch settlement:** homogeneous deposit requests, 1% entry fee, fixed reserves/rewards, either ADA or one native backing asset. Recipients were either a key address with no datum or a synthetic script address with a 512-byte byte-string payload (530 bytes of serialized Plutus Data). Each shape tested sizes 1, 2, 4, 5, 6, 7 and 8. Size 3 was not run. Testing stopped above the first failing interval; size 16 was not attempted for Batch.

| Batch shape | Largest successful sample | Signed bytes at 7 | Memory at 7 | Next tested size |
| --- | --- | --- | --- | --- |
| ADA, key recipient | 7 | 4,388 | 13,235,913 | 8 fails memory |
| ADA, script + 512-byte payload | 7 | 8,112 | 13,295,284 | 8 fails memory |
| Native backing, key recipient | 7 | 4,519 | 13,735,784 | 8 fails memory |
| Native backing, script + 512-byte payload | 7 | 8,243 | 13,898,477 | 8 fails memory |

The synthetic recipient script is not executed when receiving an output. These samples demonstrate construction and Claim preservation, not that a real receiving contract can later use the funds.

The fourth case leaves only 101,523 memory units at the measured seven-request shape. This is not sufficient headroom for advertising seven as a universal or robust operational capacity. Quantities, assets, ordering, recipient data, authority configuration and target parameters can change cost.

**Claim delivery:** authentic native-share Claims were created through batches of at most four, then delivered together. The current adapter attaches Q inline. Sizes 1, 4, 5, 6, 7, 8 and 16 were tested for both recipient forms.

| Delivery shape | Largest successful sample | Signed bytes at 5 | Memory at 5 | Larger observations |
| --- | --- | --- | --- | --- |
| Key recipient | 5 | 6,865 | 12,365,541 | 6, 7 and 8 fail memory; 16 exceeds builder size at 18,324 bytes |
| Script + 512-byte payload | 5 | 9,565 | 12,832,435 | 6, 7 and 8 fail memory; 16 exceeds builder size at 26,964 bytes |

The 16-Claim numbers are construction-reported candidate sizes, not accepted final signed sizes. A different reference-script strategy could change transaction size, but has not been measured here and would not by itself establish adequate execution memory.

The paper already says 16 is structural rather than measured capacity. These failures therefore do not contradict its throughput promise; there is no such promise. They convert a previously unmeasured release requirement into specific limited evidence and demonstrate why construction-aware selection is necessary. A failed large grouping does not imply an individual Claim is unrecoverable; smaller groups remain available.

Evidence: [batch records](evidence/integration-probes.json), [delivery records](evidence/delivery-capacity.json), and reproducible probe sources. Blueprint identities are in the baseline/build records. Actual protocol parameters, slot configuration and cost models are captured in the [parameter snapshot](evidence/protocol-parameters.json) and per-scenario transaction records; the generated-artifact manifest binds those records.

### F-06 and F-07: configuration and construction choices

| Behavior | Paper scope | Current artifacts |
| --- | --- | --- |
| Fully direct entry and exit | Supported arrangement | CTVS-1 mode 3 |
| Fully asynchronous entry and exit | Supported arrangement | CTVS-2 mode 12 |
| Direct entry, async exit, or reverse | Permitted arrangements | No build supports them |
| Other combinations of the four capability bits | Wire masks 1 through 15 | Only masks 1, 2, 3, 4, 8 and 12 admitted |
| General reference deployment | F, Q and a vault template binding their identities | CTVS-1 has F and P with no Q binding; CTVS-2 has F, P and Q |

A declared subset is not automatically an unsafe contract or a requirement to merge the two projects. Separate projects are compatible with supplying additional explicitly scoped builds. But the shared wire's ability to describe a configuration does not mean either current artifact can execute it. Exact-construction documentation must also state the synchronous specialization instead of implying identical general deployment structure.

The required combined paper acceptance trace includes direct and async behavior on authenticated identities. Current separate-family traces do not demonstrate a hybrid shared-accounting vault. That scope limit must remain visible.

### F-08: smaller client restrictions

The shared protected-input checker requires an enterprise script address. Applying it to Claim delivery is narrower than Q's payment-credential-based input domain. Ordinary Batch-generated Claims are enterprise outputs and work. Voluntarily funded supported look-alikes at the same Q payment credential with a staking component are rejected by the SDK. This particular guard-versus-SDK address difference is source-reviewed plus an executed client rejection, not a newly executed compiled staked-Q test.

Refund and delivery options also have no explicit externally funded top-up argument. They emit exactly the source value, while the guards allow additions. This matters when output minimum ADA changes or a caller wants to fund additional storage. Manual plan changes can express such permitted outputs, so this is a convenience/API capability gap rather than a missing onchain recovery right.

### F-09: evidence that this review cannot manufacture

The publication references original candidate-wire files, golden fixtures, an integration JSON schema, semantic models and historical checks that are not present in the inspected supplied materials. Current vectors were reconstructed from the PDF or retained from the implementation. They cannot prove byte-for-byte preservation of an unavailable source bundle.

Similarly, separate TS and Aiken code, CML checks and CLI/Lucid parameter agreement are useful cross-checks but not the paper's independently authored complete builder/indexer acceptance. There is no cardano-node run, public-network acceptance, real rollback replay or independent external audit in these results.

## What matched, and how strongly

CTVS-1's four direct operations, integer fee convention, rounding, exact user bounds, State value partitions, mint coupling and selected authority/maintenance paths matched the inspected paper requirements. An independent equation oracle compared 183,678 quotes and 367,356 transition outcomes, alongside 4,032 exhaustively enumerated small maximum-deposit markets, upper-domain cases, conversion invariance, adjusted-price and immediate round-trip checks. No counterexample was found in that finite corpus.

CTVS-2's reviewed snapshot settlement, per-request fees, gross burn ceiling, zero-net obligations, two-way acknowledgments, exhaustive allocation, funded Claim creation, finite deadlines and full-value recovery/delivery matched at their recorded evidence levels. Fresh SDK probes reproduced the paper's mixed-batch and distinct-economic-history examples. That does not prove those supplied example States are all reachable from this async-only genesis or establish a signed mixed zero-net trace.

Fresh isolated Aiken probes passed for 16 selected direct predicates and two actual async cancellation handler contexts with unsupported economic bodies. Aiken handler-test execution costs include the test context and are not substituted for complete transaction budgets.

The unchanged baseline gate passed with 185 TS tests, 83 CTVS-1 Aiken checks, 106 CTVS-2 Aiken checks, 26 signed local lifecycle scenarios and two parameter-only cases. TS production line coverage remains 99.61%. These totals are not interchangeable with the requirement inventory or independent conformance evidence.

## Whitepaper issues versus implementation issues

| Issue | Correct interpretation |
| --- | --- |
| Entry-only and exit-only immutable modes | The paper permits them and code admits 1, 2, 4 and 8. This is a lifecycle-policy gap/proposed improvement, not a current code/spec contradiction. Exit-only genesis also starts with zero supply and no ordinary entry route. |
| Proposed rejection in `LIMITATIONS.MD` | Documentation only. No genesis restriction was implemented during this review. |
| Original maximum-deposit search problem | The supplied revision already contains the corrected monotonic upper-capacity approach. Current implementation and fresh exhaustive checks agree; do not report the old flaw as an unfixed v0.6.3 discrepancy. |
| Phase-only async history equivalence | The supplied paper already explains why economic history matters. Fresh probes preserve the distinct outcomes rather than treating identical lifecycle labels as equivalent economics. |
| Structural cap 16 | Already provisional in the paper. Newly measured smaller sample limits are implementation/resource evidence, not a new mathematical error in the paper. |
| Paper says compiled gates were blocked | Historical evidence status is now stale relative to this source revision. Compiled and selected local signed paths exist; node/independent gates remain open. |
| Managed NAV, partial fills, script controllers, inventory shares, direct delivery at settlement | Explicit separate extensions. Their absence is not a defect against profile 0; they require separate implementations and evidence before being claimed. |

## Concrete closure order

| Priority | Work | Definition of done |
| --- | --- | --- |
| 1 | Repair SDK recovery decoding and identity normalization | Both compact recovery examples pass the public raw-data refund path; equivalent key bytes have identical authorization results; permanent positive/negative regressions pass |
| 1 before wallet-facing reuse | Complete pre-signing verification | A reviewed final-effects object binds all funding/change/fee/collateral effects; the unplanned payout probe is rejected unless explicitly approved |
| 2 | Implement the common integration boundary | Authenticated snapshot/quote/request/Claim/build responses, explicit statuses and coherent source bindings pass schema and cross-field tests |
| 2 | Implement authentic history and rollback | Real request/settlement/Claim lineage, separate ownership buckets and replacement-chain replay pass independent reconstruction tests |
| 2 | Make construction limits operational | Adaptive batch/delivery selection based on actual bytes/budgets/parameters, with heterogeneous and worst-case regression samples |
| 3 | Resolve configuration/construction claims | Explicitly document supported subsets and synchronous deployment variant; separately decide whether to supply hybrid builds and adopt lifecycle admission restrictions |
| 3 release gate | Complete independent and node-backed acceptance | Original bundle reconciled; complete positive/adversarial traces accepted/rejected by a pinned node; independent builder/decoder/indexer agreement including rollback |

The detailed closure actions belong to individual requirement rows and the S-01 through S-12 / A-01 through A-15 acceptance matrices. No contract or client fixes are silently included in this review.
