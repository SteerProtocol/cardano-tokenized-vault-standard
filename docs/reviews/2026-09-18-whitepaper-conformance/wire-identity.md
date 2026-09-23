# WIRE-2, identity and deployment conformance review

The shared records and onchain identity path substantially match the supplied revision. The fresh adversarial review found one concrete cross-layer discrepancy: the SDK can reject a small, otherwise recoverable Request before reading its supported recovery envelope. The compiled Cancel handler accepts the same two economic-body shapes. This is a client recovery limitation, with no demonstrated onchain loss of funds.

The [requirements matrix](wire-identity.requirements.json) contains 48 individually scoped requirements: 40 aligned, four partial, two narrowed, one unverified, and one extension outside scope. These are traceability groups, not a compliance percentage or proof of completeness. The two narrowed rows distinguish the recovery defect from the intentional split into synchronous and asynchronous deployment families.

## Source and evidence boundary

Reviewed the supplied **CTVS-Whitepapers-v0.6.3-Illustrated-Combined.pdf**, SHA-256 `e06e90a6eb2eb1e9ffdc90d38b7bcabd392b54b3144d78faf11c8be321054e75`, especially CTVS-1 sections 4.2, 10, 11 and 12 at physical PDF pages 14-15 and 28-36, and CTVS-2 sections 11 and 12.1-12.5 at pages 74-77. References below use physical PDF page numbers, which differ from the second paper's printed page numbers.

Source was read from the working tree at repository HEAD `75d47c90361d6f83458841b871e0f746500610e0`. The [onchain probe source manifest](probes/wire-onchain-source-bindings.json) binds the actual copied modules and generated support-script constants used in the fresh compiled probes. The review did not alter production source or permanent tests. The onchain runner copies source into an automatically cleaned temporary directory and reads the existing dependency cache; it does not modify either staged family project.

Evidence labels are deliberate:

- `source`: inspected predicates and construction paths, without claiming that inspection executes them.
- `retained_test`: located the exact existing regression and checked its assertions. The root review's fresh baseline run is separate; this reviewer did not rerun the full suite.
- `executed_probe`: ran the isolated probe linked here. The compiled probes use synthetic handler contexts. They do not include ledger phase one, signatures, collateral, or a complete serialized transaction.
- `external_gate`: the required original artifact, real network binding or independent acceptance evidence was not available from the reviewed source.

## F-W1: generic SDK decoding narrows supported Request recovery

**Impact: client recovery availability.** CTVS-1 section 10.7 (PDF 32) explicitly exempts recovery's economic body from recipient-data and settlement-body limits before dispatch. CTVS-2 section 12.2 (PDF 75) types that outer field as raw `Data` and forbids fully deserializing a typed economic request before Cancel. The opaque recipient constructor cap of 127 is therefore not a bound on this economic body.

Two concrete Requests have a valid outer tag/version and a valid fixed key-controller recovery envelope:

| Economic body | Whole Request CBOR | Independent CML decode | Default SDK decode before recovery | SDK with `maxDepth:128` | Compiled Cancel handler |
|---|---:|---|---|---|---|
| `Constr(9007199254740992, [])` | 144 bytes | Accepted | `constructor index exceeds safe integer` | Same rejection | Passed |
| 65 nested singleton lists around integer zero | 197 bytes | Accepted | `CBOR structural budget exceeded` | Recovery succeeded | Passed |

The first alternative is `2^53`, exactly representable as a CBOR unsigned 64-bit constructor alternative. The dependency's constructor value is already a bigint. The adapter rejects it at [codec.ts:37](../../../reference/packages/protocol/src/data/codec.ts#L37), because the public constructor representation uses JavaScript numbers. The second Request is rejected by the generic decoder's default depth of 64 at [codec.ts:122](../../../reference/packages/protocol/src/data/codec.ts#L122). The recovery projection at [requests.ts:89](../../../reference/packages/protocol/src/wire/requests.ts#L89) is itself appropriately shallow, but callers cannot reach it through the normal `decodeData(rawCbor)` path for these inputs. The fresh control `decodeData(rawCbor, {maxDepth: 128})` followed by `requestRecoveryFromData` succeeds for the second case. It still rejects the first case. The depth case is a default-decoder limitation with an available override; the constructor-domain restriction is non-configurable.

This is not a claim that every arbitrarily large escrow must be recoverable. Both demonstrated encodings are small. Nor is it a claim that the onchain handler imposes the wrong limit. Its [raw Request decoder](../../../reference/packages/onchain/lib/ctvs/decode.ak#L104), [recovery validation](../../../reference/packages/onchain/lib/ctvs/validation.ak#L269), and [dispatch-before-economic-downcast](../../../reference/implementations/ctvs2/onchain/lib/ctvs2/async.ak#L78) preserve the required distinction. The compiled probe calls the actual `vault.vault.spend` Cancel handler with a fixed full-value refund, explicit controller signer and finite validity interval.

The exact raw CBOR, CML acceptance, SDK errors, source and results are retained in [wire-client-probe.mjs](probes/wire-client-probe.mjs), [wire-client-probe.json](probes/wire-client-probe.json), [wire-onchain.ak](probes/wire-onchain.ak), and [wire-onchain-results.json](probes/wire-onchain-results.json). The two compiled tests used 877,830 memory / 291,102,315 CPU and 1,033,652 memory / 344,401,776 CPU respectively. Those units include fixture evaluation and are not transaction resource measurements.

The existing test named `does not silently round a constructor index outside its public safe-integer domain` deliberately locks in the first generic-decoder restriction. Avoiding rounding is correct; using that restricted representation as a prerequisite for recovery is the conformance problem. A fix should either preserve a lossless constructor-index domain or project Recovery directly from the outer CBOR structure while leaving economic-body data uninterpreted. The exact two cases should become client/onchain cross-layer regressions. No fix was made during this review.

## Exact shape and semantic checks

The review traced every protocol-owned record and action from the paper to both public wire source and the scoped decoders. The record inventory is:

| Record | Public constructor / field count | Relevant result |
|---|---|---|
| Terms | `C0 / 13` | Exact options, numeric limits, asset, destinations, settlers, mode bits and metadata |
| Config | `C3 / 7` | Terms validated and committed; external parameter binding also required |
| State | `C0 / 10` | No extension, epoch, oracle or mutable economics fields |
| Recovery | `C0 / 4` | Policy, key Controller, exact refund Destination and deadline |
| Request | `C1 / 4` | Recovery decoded; economic body retained raw onchain |
| RequestBody | `C0 / 8` | Only exact-gross deposit and exact-share redeem kinds |
| Claim | `C2 / 10` | Consumed predecessor references; creating transaction identity external |
| All role envelopes | Role `0..3 / 3` | Magic, version, action; roles checked before private rebasing |

The fresh SDK mutation corpus appended a field to every constructor reached in representative Terms, Config, State, Request and Claim records: respectively 11, 13, 1, 15 and 9 cases. All 49 were rejected. This checks recursive arity in that corpus, including options, credentials, stake wrappers, references, assets and request kind. It is not evidence that every possible invalid object has been enumerated. Existing compiled negative tests independently exercise malformed credential, controller, Terms, role and action shapes.

Primitive checks preserve the full payment/staking address pair, distinguish `NoDatum` from exact inline data and datum hashes, reject pointer staking, use key-only controllers, and require native asset names of 0..32 bytes. Fresh boundary probes confirmed empty and 32-byte names accepted, 33 bytes rejected, OutRef indices 0 and 65535 accepted, and -1/65536 rejected. Actual output lookup separately checks array bounds; the wire bound is not a capacity promise.

All four direct actions have the paper's five fields and scoped tags 0..3. Batch tag 4, maintenance tags 5..7, Request tags 0..2, Mint tags 0..1 and Claim Deliver tag 0 match the declared arities. Deterministic list checks order transaction-ID bytes then numeric output indices, reject duplicate references, and enforce count 1..16. Batch also applies immutable `max_batch`. Deliver requires exhaustive consumed Q coverage and equal semantic lists across every participating redeemer. Those allocations have distinct output indices.

The physical balance checks are outside the bare State codec where the underlying asset is needed. The authenticated onchain validator and planner context enforce `A+F+R <= Qmax` for ADA or `A+F <= Qmax` for a native underlying, together with exact State token/value/address equations. The bare codec accepting individually valid scalar fields does not, by itself, claim that a State is authentic or physically balanced.

## Commitment and codec findings

The Terms domain is the exact 14 bytes `435456532f48322f5445524d5300`, including its last zero byte. The fresh probe recomputed the retained Terms commitment as `3e786871c31d0ba1684920693cbb3ae53e42eca96d272280bf732e44b8844220`. The onchain source uses builtin `serialise_data` and Blake2b-256, after Terms validation, and the retained compiled test compares those exact bytes and hash against the client vector. This is a semantic Terms commitment, separate from hashing original ledger datum bytes.

The maintained codec adapter explicitly restores the protocol's definite ordered maps, list encoding conventions and bounded byte chunks. Retained adversarial tests cover truncated and trailing CBOR, unsupported tags/types, extended constructor arities, tagged bignum misuse as constructor indices, empty integer magnitudes, 65-byte integer-magnitude chunks and duplicate semantic map keys with alternate constructor spellings. Fresh map probes confirmed that reversing two opaque pairs changes the Terms hash. No lossy dictionary conversion was found.

Opaque recipient bounds are applied to depth, node count, integer/constructor domains and normalized bytes before hashing recipient-bearing records. The 1024-byte normalized cap counts CBOR overhead, not merely leaf bytes. The record-size limits match the paper: State 256, Terms 4096, Config 4608, settlement Request 4096, Claim 2048. Recovery does not apply the settlement Request cap; a fresh 5000-byte body remained recoverable through the SDK projection. That success does not close F-W1.

One resource qualification remains. The generic CBOR dependency's recursive scan precedes the adapter's own depth/node traversal. Stack exhaustion is converted into an explicit resource-limit error, and the retained stress test proves rejection. It does not prove configurable pre-parse depth enforcement or bounded work before allocation. This is W-036, separate from the small-depth recovery counterexample.

Builtin certification is specific, not universal. There is a pinned compiled Terms vector/hash test and compiled scoped decoder coverage. This review did not establish a builtin differential corpus covering every valid opaque Data shape and alternate encoding. It also cannot certify the paper's historical 22 fixtures and 44 comparisons, because the authenticated original bundle was not supplied.

## Identity, build binding and the declared family split

The two-pass build compiles support scripts, inserts their hashes into generated `ctvs/deployment.ak`, recompiles, and verifies their identities did not change. The per-vault mint and spend artifacts must have identical compiled bytes and hashes. Staging preserves byte hashes, rejects duplicate modules and symlinks, and reserves the generated module path against authored overrides. The compiler version is exact, not an open version range. The support lock rejects all spending; Q contains no dependency on a per-vault policy.

The parameter CLI validates a 32-byte seed hash, bounded output index and 32-byte commitment, applies both parameters, and checks the final mint/spend identity and absence of remaining parameters. The retained two-family integration test compares Aiken CLI application to independently constructed Lucid parameter Data and its Plutus V3 versioned script hash, normalizing only the single/double script-CBOR wrapper. It deliberately uses a synthetic seed and is not evidence that that seed exists or that a transaction was accepted.

Genesis consumes the parameter seed and requires an exact mint map of ID(1) and STATE(1). It authenticates Config against parameter seed/hK, checks its exact reserve/ID value at F, and requires zero economic State at enterprise P with a positive funded reserve. It rejects underlying under P, additional assets, wrong identities/addresses, reference scripts and nonzero initial accounting. Future minting is whole-map SHARE delta equality coupled to an authentic selected State, so the supply path cannot mint or burn ID/STATE. Vault dispatch tests STATE identity before interpreting a datum as State or Request.

The source intentionally implements a narrower capability set than the combined construction in paper section 4.2: CTVS-1 admits modes 1, 2 and 3, with F and P and `claim:null`; CTVS-2 admits 4, 8 and 12, with F, Q and P. Neither supports mixed direct/async mode combinations. The shared wire still represents 1..15. This is an explicit implementation choice resulting from the requested two-family split, recorded as W-038; it should not be advertised as one deployment implementing the entire combined mode space.

Actual network identity remains an acceptance boundary. Planners check supplied network/domain consistency but mark it `verifiedOnLedger:false`, with ledger authentication listed as unresolved. The local harness operates an explicitly chosen emulator network. Nothing here turns a caller-supplied domain label into a verified real-chain identity.

## Reproduction and outstanding acceptance gates

From `reference/`, rerun the fresh SDK/CML probes:

```sh
node --import tsx ../docs/reviews/2026-09-18-whitepaper-conformance/probes/wire-client-probe.mjs
```

From the repository root, after the normal build has made its dependency cache and support bindings available:

```sh
AIKEN=/path/to/aiken-v1.1.22 python3 docs/reviews/2026-09-18-whitepaper-conformance/probes/wire-run-onchain.py
```

The retained compiler run was `aiken v1.1.22+39d6b04`, with deterministic test seed 20260918, two passed and zero failed. The runner writes source hashes, result JSON and stderr into the review directory, and deletes only its own temporary project.

The historical `candidate-wire/schema.json`, `wire.cddl` and the full original four-file bundle were not authenticated from supplied artifacts. Generated blueprint schemas, preserved local vectors and matching visible paper fields do not establish their byte-for-byte continuity. Obtain the original bundle and trusted checksums before making that claim. Managed valuation, epochs, partial fills, script controllers and capability continuations remain separate profiles, outside this profile-0 wire review. No production changes, network submissions or complete-ledger acceptance claims arise from these probes.
