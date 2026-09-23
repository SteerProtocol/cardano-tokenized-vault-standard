# Strict code quality review

**Recommendation: request changes.** The behavioral fixes have good regression coverage, but the new infrastructure duplicates responsibilities and has a public type contract that does not support ordinary consumer narrowing. Four substantive findings follow.

## Scope and evidence

Reviewed the working-tree changes against `75d47c90361d6f83458841b871e0f746500610e0`, including untracked reference packages and tests. The branch is `main`; these are uncommitted changes. The separate missing `meeting-site` submodule is outside this implementation review and was not modified.

The inventory includes **52 changed/new TypeScript or Aiken files**, of which **31 are new**. No changed file crosses 1,000 lines. The largest production files are `integration/src/reader.ts` at 450 lines and `cardano/src/effects.ts` at 412. File length alone is not the reason to request changes.

Three independent scoped passes covered integration state/responses, wallet effects/harness, and protocol/planning/selection. Source inspection was supplemented with a TypeScript consumer probe, runtime identity-validation probes, and a synthetic irrelevant-output retention probe. Fresh focused verification passed **250 tests** across two nonoverlapping runs. The complete reference source digest still matches the preceding successful full gate: 288 TypeScript tests, 85/108 Aiken checks and 31 integration checks. The complete gate was not rerun during this review because production source was unchanged.

[Machine-readable evidence](evidence.json) includes source inventory/hashes, probe inputs/results and test commands. No production or test files were changed by this review.

## 1. P2: Restrict the projection to data the vault reader owns

Primary location: [project.ts:148](../../../reference/packages/integration/src/project.ts#L148). Related locations: `reader.ts:103`, `reader.ts:365-373`.

Every ordinary accepted output is inserted into `Projection.utxos`, including transfers unrelated to any discovered vault. Each subsequent block clones the entire projection, and every ownership query scans the entire UTxO map. The accepted feed must be complete, but the vault projection does not need to become a second general-purpose chain UTxO index.

The synthetic probe started with one discovered vault and two protected UTxOs. Adding 32 unrelated ADA-only transfers left the vault/Request/Claim counts unchanged but increased retained UTxOs from 2 to 34. This is observed unnecessary retention, not a speculative scalability claim or a demand for a production database.

**Restructure:** continue consuming the complete feed and retain the replay journal, but keep projected outputs only when they contain tracked SHARE assets, are at tracked vault addresses (including unsupported recovery candidates), are exact authenticated Config/State references, or are authenticated Claims. Apply spends to this relevant subset. External wallet funding already enters through `WalletAuthorization` and does not require retention in this map. Preserve atomic block application and rollback behavior.

**Regression to retain:** insert a large run of unrelated transfers between vault events and prove the projected relevant UTxO count and ownership results remain unchanged; then replay settlement, delivery and their rollbacks. Candidate recovery must still recognize malformed economics and CIP-40 collateral returns.

## 2. P2: Prepare once, then submit the measured transaction

Primary location: [selection.ts:49](../../../reference/testing/ledger/selection.ts#L49). Related locations: `testing/ledger/recorder.ts:53-109`, `testing/integration/ctvs2/selection.test.ts:120-121,168`.

Selection and submission each implement completion, effects verification, signing, approval binding, signed-size checking and final signed evaluation. They already differ: selection additionally runs the older protected-output checker twice, while the recorder checks complete effects and retains a separate signature/witness loop. Any future safeguard must now be installed consistently in multiple preparation paths.

The integration test then discards the prepared signed bytes and submits a reconstruction of its plan. That reconstruction is checked again, so this is not evidence of an unchecked transaction. It does mean selection measures one transaction while the normal path creates another, and the test does not establish that the exact measured candidate was submitted.

**Restructure:** extract one preparation operation returning the signed transaction/CBOR, approval, size, witness summary and evaluation evidence. Selection invokes it without submission. The recorder submits and records that exact prepared result, with freshness checks appropriate to the caller. Keep authorization before construction, effect verification before signing, signature verification and final signed evaluation. Do not replace these checks with a thin wrapper around only the current selection path.

Use the existing typed `ResourceLimitError` for locally measured limits. The selector currently parses the evaluator's own assertion text at `testing/ledger/selection.ts:17-25`; local message wording should not decide whether a smaller group is tried. Keep string adaptation only at the pinned third-party error boundary.

**Regression to retain:** assert the prepared and submitted hashes/CBOR match; exercise the extra-payment, altered minimum ADA, insufficient signature/budget and resource-limit cases through the single preparation path.

## 3. P2: Make response kinds and observations real discriminants

Primary location: [types.ts:72](../../../reference/packages/integration/src/types.ts#L72). Related locations: `reader.ts:132`, `reader.ts:284-295`, `reader.ts:326`.

`Envelope<T>.kind` is a generic string. Some observation branches infer `status: string`, while candidate recovery is explicitly typed as `Observation<unknown>`. The exported reader therefore loses information that it already knows and forces callers toward casts or redundant checks.

A read-only consumer probe produced three actual compiler failures:

```ts
const response = condition ? reader.snapshot(policy) : reader.quote(policy, "deposit", 1n);
if (response.kind === "snapshot") response.data.backingAssets; // TS2339

const request = reader.request(policy, ref);
if (request.data.recoveryAvailability.status === "known")
  request.data.recoveryAvailability.value; // TS2339

const candidate = reader.candidate(policy, ref);
if (candidate.data.recovery.status === "known")
  candidate.data.recovery.value.deadlinePosixMs; // TS18046
```

**Restructure:** define the public payload contracts and a response-kind-to-payload mapping, or use `Envelope<K, T>` with literal kinds. Give every observation branch its declared `Observation<T>` type, and retain `Recovery` rather than erasing it to `unknown`. A small compile-only consumer test should enforce these contracts. No runtime schema framework is necessary.

Keep response formatting separate from domain queries. For example, `ownership()` currently calls the public `request()` response builder merely to obtain a validation result, including a full envelope clone for each matching Request. A pure domain query or an ingestion-time immutable classification supplies that fact directly.

**Regression to retain:** compile the three examples above without casts, and verify serialized response fields remain compatible.

## 4. P2: Use one canonical Cardano normalization boundary

Primary location: [effects-ledger.ts:74](../../../reference/packages/cardano/src/effects-ledger.ts#L74). Related locations: `effects-ledger.ts:17-28,96-103`, `integration/ledger.ts:58-73`, `testing/ledger/serialization.ts:36`.

The effects package reimplements reference and asset identifier validation already owned by `@ctvs/protocol`. Those rules have already diverged:

| Input | Effects helper | Canonical protocol helper |
| --- | --- | --- |
| Output reference with numeric `index: 1` | `refKey` accepts | `refId` rejects, bigint required |
| Native asset name `.a` | `normalizedValue` accepts | `assetId` rejects odd-length hexadecimal bytes |

These probes demonstrate inconsistent boundary validation. They do not establish an onchain exploit.

Generic CML handling is duplicated too. `withCml` reproduces Lucid's existing `withCMLScope`, which integration already uses. The reader manually branches over legacy/map redeemers while the effects verifier uses CML's existing `to_flat_format()`. Output asset conversion is repeated in effects, integration and test serialization.

**Restructure:** reuse protocol identity parsing and Lucid/CML primitives directly. Put the small shared ledger-to-protocol conversion in `@ctvs/cardano` and consume it from integration and the harness. Keep wallet authorization and accepted-history policy separate. Keep signed value arithmetic separate from unsigned custody validation, because negative mint quantities are legitimate; replacing it blindly with `planning.actualValue` would be wrong.

**Regression to retain:** run one identity/representation corpus through each public boundary, retaining canonical input ordering, datum/reference-script distinctions, base/enterprise/Pointer address cases and invalid-script collateral-return indexing.

## What should stay

The separate CTVS-1/CTVS-2 projects, maintained cryptographic/CBOR libraries, raw recovery projection, validated hexadecimal comparisons, and measured prefix selection are appropriate. The number/bigint constructor representation has an explicit small-number compatibility purpose. No convincing reason emerged to replace the selector with a generic scheduling engine or to add a production database/node framework.

The lifecycle model also has redundant state: Request status, nullable settlement/completion and Claim delivery flags. Its current updates are consistent and block application is atomic, so it is not reported as another defect. When restructuring reader queries, a discriminated lifecycle record with derived Claim status would remove impossible combinations and the current dependence on settlement mutation preceding Request-consumption classification. Do not add a state-machine library for these four states.

## Suggested implementation order

1. Reuse canonical identity/CML helpers, preserving behavior with the existing adversarial corpus.
2. Extract the single prepare/submit boundary and submit the measured candidate.
3. Define discriminated response contracts and separate domain queries from envelope formatting.
4. Narrow the projected UTxO set and verify replay/ownership invariants.

This sequence removes duplicated behavior before reorganizing the reader. It preserves contract bytes and supported economic behavior while making the reference implementation smaller and easier to extend safely.
