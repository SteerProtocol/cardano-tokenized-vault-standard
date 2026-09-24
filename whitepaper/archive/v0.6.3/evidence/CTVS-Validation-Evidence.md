# CTVS validation evidence

Publication companion for CTVS-1 and CTVS-2, revision 0.6. Recorded technical baseline: repository revision `f5f782de9ba6a7bf6cbb8213995a31734888559c` and the supplied local evidence records of 8–9 September 2026.

## Scope

The economic/semantic model and the wire-format codec/selected boundary predicates are distinct programs. Neither is a deployed or complete compiled Cardano validator. Their local success does not establish the correctness of their composition. The model and tests were authored together; cross-language comparison is not independent external review.

This document carries forward recorded evidence. Revision 0.6 clarifies common versus reference requirements, specifies a native-format conformance route and a bounded semantic direct-delivery variant, and provides an off-chain response contract. It introduces no new compiler, builtin, cryptographic, ledger, receiving-script, resource or managed-protocol execution result. Historical records below are carried forward, not re-executed. The dated publication/arithmetic/schema checks are under `archive/v0.6.3/checks/`.

## Recorded results

| Verification family | Recorded result | Scope |
|---|---:|---|
| Semantic transaction-model unit tests | 85 passed | Selected direct/async, key-role, recovery, delivery, and projected-ledger checks |
| Rational arithmetic oracle | 2,000 samples | Bounded deposit/redeem comparisons |
| Maximum-deposit search | 384 configurations | Comparison with finite exhaustive enumeration |
| Economic lifecycle exploration | 96 full states; 213 transitions | Three requests; 64 phase combinations; fixed valuation |
| Targeted predicate omissions | 10 detected | Ten chosen value-balanced counterexamples, not an exhaustive mutation score |
| Historical arithmetic rerun | 600,000 quotes; 30,000 batches; 10 value balances | Accounting evidence, not transaction ownership security |
| Python codec/schema tests | 71 passed | Candidate Data codecs, recursive constraints, selected role/link/allocation rules |
| Byte fixtures | 22 | Candidate expected bytes, not Plutus-certified encodings |
| JavaScript codec correspondence | 44 comparisons | The same 22 fixtures in two encodings; common author with Python |

The two main papers report these same records. Do not sum the tables as separate runs. The original numeric result snapshots are archived in `archive/v0.6.3/evidence/semantic-results.json` and `archive/v0.6.3/evidence/wire-results.json`. Publication aliases do not modify their numerical results.

## Corrections retained in the main specifications

Value conservation alone cannot establish destination or authority correctness. The semantic model therefore records addresses, datum requirements, source references, signatory assumptions, time intervals, and allocation obligations. Its fixture identities are trusted premises, not a demonstrated genesis construction.

A lifecycle phase label is not a complete economic state. The state key also includes backing, supply, fees, and claim quantities; different settlement orders can lead to different economic outcomes with identical phase labels.

A positive operation may fail below a rounding threshold, succeed over an interval, and fail above a cap. Maximum-deposit search is therefore defined over monotonic upper-resource constraints, followed by a positive-output check; it is not binary search over the complete acceptance predicate.

The wire candidate separates a supported recovery envelope from an opaque economic request body. Refund eligibility need not require valid settlement economics. Actual input value, including surplus, is preserved in fixed refund and claim delivery. These predicates do not guarantee that every possible output can be spent within real resource limits.

## Wire-format evidence and compatibility

The candidate's public identifier is **CTVS-WIRE-2**. The on-chain magic remains `CTVS`, the wire integer is **2**, and the reference profile is **0**. Constructor tags, recursive field layouts, candidate byte files and commitment bytes are unchanged. Original reference mathematical examples are retained. New native-delivery and budget-reparameterization examples do not create new reference-wire actions.

The terms domain is the fixed 14-byte constant `435456532f48322f5445524d5300`, expressed in hexadecimal including the final zero byte. Implementations decode this representation to bytes; they do not hash its printed characters or derive the domain from the public name. Changing a publication label must not alter deployment commitments.

`candidate-wire/schema.json` fixes recursive constructor fields. The CDDL companion records shapes but was not executed through a CDDL engine. `golden.json` contains candidate expected bytes and equivalent representations. `types.ak` contains uncompiled Aiken type declarations; renaming a source-level type label is not a claim that any program has been compiled or its hash measured.

Representative normalized datum sizes are Config 333 bytes, State 92 bytes, Request 310 bytes, and Claim 311 bytes. These are fixture datums only, not complete outputs, worst-case limits, fees, or minimum-ADA measurements.

## Unclosed acceptance gates

Compiled genesis and full-address/purpose/hash authentication; actual Plutus context interpretation; pinned `serialiseData` agreement; complete economic and output validation; phase-1 and phase-2 ledger acceptance; collateral and output minima; measured resource bounds; actual capability authorization; managed-protocol accounting and execution; and independent builders/indexers/review remain outstanding.

This document preserves the historical requirement-level status, with its original machine snapshot at `archive/v0.6.3/evidence/assurance-register.json`; the full table is no longer duplicated in both papers. Every gate in that dated record remains marked blocked. Later profile-0 implementation evidence is reported separately in the [reference validation record](../../reference/VALIDATION.md). A positive compiled implementation trace is required in addition to negative rejection tests; a reject-everything script is not conforming.

## Publication versus validation

The supplied public source bundle is a publication, candidate-schema, and recorded-evidence export. It is not the original executable validation source distribution. Original runner sources, review labels, and archive mappings are retained in a separate internal provenance record. This distinction prevents an editorial document export from being represented as a new validation release.

## Shared requirement register

The preserved register refers to the reference candidate and original acceptance requirements. Its historical publication identifier remains 0.5 because the record is not being silently rewritten. Revision 0.6 carries it forward with all dispositions blocked. New native mapping/direct-delivery targets are not completed by the old evidence; apply the same applicable identity, authority, allocation, schema, ledger and independent-integration gates to each pinned implementation.

| ID | Requirement | Recorded evidence | Remaining acceptance artifact |
|---|---|---|---|
| REQ-01 | Genesis and unique identities | E0; concrete T/F/Q candidate | Compiled seed, policy, role and initial-state vectors |
| REQ-02 | Configuration and state succession | E2; selected role/config boundary checks | Real full-address, purpose, hash and successor enforcement |
| REQ-03 | Supply and zero-net gross obligations | E2; exact purpose/link requirements | Compiled spend/mint and zero-net ledger trace |
| REQ-04 | Quotes, fees and limits | E2; corrected economic search | Decoded input/refinement tests and all arithmetic bounds |
| REQ-05 | Custody, fees and storage | E2; selected value-boundary predicates | Ledger-valid partitions, collateral separation, balanced theft rejection |
| REQ-06 | Coverage and output allocation | E2; linkage/allocation primitives | Complete multi-handler coverage and disjoint payouts |
| REQ-07 | Ownership and operator permissions | E2: keys only; exact key schema | Ledger witnesses; separately executed capability profile |
| REQ-08 | Request/claim lifecycle and recovery | E2; Recovery/Data separation | Compiled branch-independent recovery and funded delivery |
| REQ-09 | Time, pauses and replay | E2; exact candidate requirements | Actual interval mapping and real rollback/replay |
| REQ-10 | Recursive encoding and commitments | 22 fixtures; local codec/schema checks | Pinned Aiken, builtin bytes, independent semantics and blueprint |
| REQ-11 | Model-to-validator refinement | E0; mapping obligations specified | Actual context projection and compiled positive/negative agreement |
| REQ-12 | Ledger and resource feasibility | E0; provisional structural limits | Accepted serialized traces and measured worst-case budgets |
| REQ-13 | Managed permissioned integration | E0; exact state-basis NAV obligation | Concrete position, liability, valuation and recovery lifecycle |
| REQ-14 | Independent builders/indexers | E0; provider/identity requirements | Independent construction, indexing, rollback and review |

## New revision checks versus historical validation

`archive/v0.6.3/checks/revision-results.json` records only the checks run for the historical revision-0.6 publication: unchanged candidate artifacts; retained example arithmetic and balances; direct-delivery substitution; budget and inventory identities; response shape examples and rejects; and source references. PDF preflight records are under `archive/v0.6.3/checks/preflight/`. No deployed native mapping was tested by those checks. The archived response fixtures contain repeated-byte identifiers and are labeled illustrative; they must never be submitted or used as authentic network data.

The historical papers use one shared evidence record, not separate runs. Their original E3 compiled-handler, E4 ledger, and E5 independent-integration gaps describe that dated record. The later reference implementation has separate local results and remaining gates in the [reference validation record](../../reference/VALIDATION.md). The archived off-chain response schema was a proposed presentation/interface contract, not a script validator or the maintained reference reader's exact response shape.
