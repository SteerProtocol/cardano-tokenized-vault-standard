# Kupo and Ogmios reference integration plan

Status: proposed implementation plan, not completed verification.

Prepared: 29 September 2026.

Scope: connect the existing CTVS reader and transaction tooling to accepted chain data, add durable restart, and verify the current Direct Custody Profile against a real Cardano node. Preserve backend independence and existing transaction permissions.

This plan incorporates three separate reviews: specification compatibility, chain integration, and filesystem organization with verification coverage. The review was read-only. No live node, crash-recovery test, resource benchmark, independent interoperability test, or new full test run was performed while preparing it.

## 1. Intended result and evidence boundary

The deliverable is one reference backend using Kupo and Ogmios. It must discover authentic vaults from accepted history, expose coherent snapshots and quotes, reconstruct Request/Claim lifecycle and ownership, recover from interruptions, and support node-backed verification of existing transactions.

The standard remains independent of Kupo, Ogmios, SQLite and the chosen runtime. These are implementation choices for this reference backend, not additional conformance requirements for other protocols.

There are three distinct completion claims:

| Claim | Evidence needed | Initial target |
| --- | --- | --- |
| Reference adapter works for the declared workload | Deterministic contract tests, persistence/recovery tests, actual node lifecycle acceptance and measured resource envelope | Yes |
| Integration meets the whitepaper's independent verification bar | Separate decoder/indexer and independently constructed transactions agree on actual accepted history and rollback | Required before advertising this broader claim |
| Production service is suitable for continuous indexing | Representative long-running load, bounded resource design, operational recovery and deployment-specific validation | Not established by the initial reference adapter |

Passing local tests is not evidence of node acceptance. Observing node acceptance is not an independent implementation review. A successful controlled testnet run is not proof of production security or scalability.

## 2. Current state and reusable components

The workspace already has TypeScript, Lucid Evolution, CML, Vitest, fast-check, Aiken, Biome and ESLint. Reuse these tools. Do not replace existing wire decoding, share math, transaction planning or effects checks.

| Component | Existing role | How this work uses it |
| --- | --- | --- |
| `@ctvs/protocol` | Shared representation, wire validation and integer economics | Unchanged economic authority |
| `@ctvs/planning` | Reviewable transaction intents and protected allocations | Existing plans for both families |
| `@ctvs/cardano` | Complete wallet effects and resource-aware selection | Verify final constructed body before signing |
| `@ctvs/integration` | Accepted-history authentication, projection and semantic responses | Existing reader remains the only protocol projection |
| Lucid `Kupmios` | UTxO/datum lookup, parameters, evaluation and submission | Configure the installed provider rather than implement another provider |
| `testing/ledger` | Local construction, signing, evaluation and evidence recording | Reuse or narrowly extract test utilities for node-backed scenarios |
| CTVS-1/CTVS-2 Aiken projects | Independently compiled contract families | Deploy actual compiled artifacts and verify existing operations |

Key existing sources:

- [Accepted history and response contracts](/Users/derekbarrera/Development/SteerProtocol/cardano-vault-standard/reference/packages/integration/src/types.ts).
- [Reader staging, history and rollback](/Users/derekbarrera/Development/SteerProtocol/cardano-vault-standard/reference/packages/integration/src/reader.ts).
- [Accepted transaction decoding](/Users/derekbarrera/Development/SteerProtocol/cardano-vault-standard/reference/packages/integration/src/ledger.ts).
- [Projection and lineage rules](/Users/derekbarrera/Development/SteerProtocol/cardano-vault-standard/reference/packages/integration/src/project.ts).
- [Testing guide](/Users/derekbarrera/Development/SteerProtocol/cardano-vault-standard/reference/testing/README.md).
- [Historical validation record](/Users/derekbarrera/Development/SteerProtocol/cardano-vault-standard/reference/VALIDATION.md).

The latest full run described in that validation record is dated 18 September. It explicitly excludes node-backed acceptance and independent interoperability. It must not be presented as a fresh verification of the currently modified sources.

### 2.1 Important limitations

The reader currently:

1. Keeps accepted blocks in memory.
2. Keeps transaction IDs and effective UTxOs, including unrelated outputs.
3. Clones its full projection when applying a block.
4. Replays the retained prefix to handle rollback.
5. Depends on a caller-trusted accepted-block feed.
6. Requires authenticated vault genesis to occur within the supplied history.

A durable journal improves recovery but does not remove these memory and replay costs. The initial implementation must declare a controlled workload and refuse to imply that mainnet indexing is already suitable.

Current test construction lives in the testing tree. Using it for node acceptance tests does not automatically make it a supported production builder API.

## 3. Specification obligations

Use current source documents as the implementation target. At implementation start, record their content hashes and the working-tree diff, including uncommitted changes. Git commit identity alone does not identify the current specification.

| Requirement | Source | Implementation consequence |
| --- | --- | --- |
| Backend-independent integration | CTVS-1 Section 13.1 | No vendor-specific requirements added to the standard |
| Authenticated share-to-vault lookup | CTVS-1 Sections 13.1 and 13.5 | Replay verified genesis; present-day token or datum lookup alone is insufficient |
| Explicit units and uncertainty | CTVS-1 Section 13.2 | Keep ledger integers and known/unknown/unsupported/stale distinctions |
| Coherent snapshot and quote basis | CTVS-1 Section 13.3 | Never label mixed-history data as one coherent snapshot |
| Realized results separate from quotes | CTVS-1 Section 13.4 | Submission and estimation cannot create accepted lifecycle results |
| Rollback reverses status and quantities | CTVS-1 Section 13.4; CTVS-2 recovery/rollback requirements | Reverse ownership and lineage as well as status labels |
| Independent integration | CTVS-1 Sections 13.5 and 15.5 | Same-library wrappers cannot close the independence gate |
| Bounded resources | CTVS-1 Sections 14 and 15.1 | Measure complete transactions and declared reader workload |
| Current async accounting | CTVS-2 Sections 5 through 7 | Preserve snapshot pricing, funded claims and recovery rules |

Sources: [CTVS-1](/Users/derekbarrera/Development/SteerProtocol/cardano-vault-standard/whitepaper/CTVS-1.md), [CTVS-2](/Users/derekbarrera/Development/SteerProtocol/cardano-vault-standard/whitepaper/CTVS-2.md).

The current Direct Custody Profile disallows withdrawals, including zero withdrawals, and unrelated script-spending families. The Aiken guard, planner restrictions and wallet effects checks agree on this. This integration must preserve those restrictions.

### 3.1 Liquidity and capacity

The current direct-custody snapshot reports backing as available liquidity under its profile. This is not a claim that a transaction can be funded, witnessed and included immediately.

Keep these separate:

- Economic backing and economic operation bounds.
- Current pause and authorization conditions.
- Constructed transaction capacity under actual parameters.
- Wallet funding, collateral and reference-script availability.
- Async settlement or delivery prerequisites.

Do not infer maximum batch size from a wire list bound. Do not turn unknown construction capacity into zero or a fabricated positive maximum. Do not add a generic managed-liquidity solver in this work.

## 4. Scope controls

### 4.1 Included

- One Ogmios accepted-chain adapter.
- Existing Kupmios provider configuration.
- One durable accepted-history journal.
- One serialized reader host.
- A thin executable and reproducible local test environment.
- Contract, replay, recovery, node lifecycle and rollback verification.
- Evidence recording and specification traceability.
- A measured workload envelope and explicit failure behavior.

### 4.2 Excluded

- New share math, vault wire formats or economic profiles.
- Enabling Price withdrawals in the direct-custody contracts.
- Native Liqwid or RealFi integration by analogy to the hypothetical example.
- Strategy execution, looping, debt accounting or managed NAV reconciliation.
- Signed NAV reporters or generic oracle infrastructure.
- Balius/WASM, downloadable adapter registries or generalized plugin systems.
- A public HTTP platform, UI, authentication service or cloud deployment framework.
- A second transaction provider, generic ORM or duplicate UTxO database.
- Automatic production signing or a keeper/batcher service.
- Mainnet deployment, public-network transactions or production readiness claims.

Only expand scope after a concrete test or specification obligation shows the missing capability. Document the failed gate and proposed change before widening the design.

## 5. Proposed filesystem layout and ownership

All proposed paths below are under `/Users/derekbarrera/Development/SteerProtocol/cardano-vault-standard/reference`.

```text
packages/
  chain/
    package.json
    README.md
    src/
      index.ts
      ogmios.ts
      provider.ts
      journal.ts
      runner.ts
    test/
      ogmios.test.ts
      provider.test.ts
      journal.test.ts
      runner.test.ts

testing/
  integration/
    chain/
      replay.test.ts
      recovery.test.ts
  node/
    environment.ts
    ctvs1.test.ts
    ctvs2.test.ts
    rollback.test.ts
    fixtures/
      README.md
      accepted-history.json

tools/
  run-reader.ts

artifacts/
  chain/
  node/
```

This is a responsibility map, not a requirement to create empty scaffolding. Add helper files only when a substantive responsibility or existing complexity rule warrants them.

| File/component | Owns | Must not own |
| --- | --- | --- |
| `ogmios.ts` | Connection, intersection and translation into ordered accepted events | Economic decoding or a second projection |
| `provider.ts` | Thin Kupmios setup and safe quantity transport | Reimplementation of lookup, evaluation or submission |
| `journal.ts` | Durable history, identity binding, head and rollback truncation | A second economic state database |
| `runner.ts` | Sequential processing, startup replay, commit/publication ordering and shutdown | Signing or strategy decisions |
| Existing integration reader | Authentication, lineage, ownership and quotes | WebSocket, endpoint secrets or filesystem access |
| Node tests | Disposable network, wallets, execution and evidence | A public production builder contract |
| `run-reader.ts` | Argument/config loading and wiring | Duplicated business logic |

One `@ctvs/chain` package isolates node and filesystem dependencies from the reader. Existing workspace and coverage patterns already include `packages/*`. Add a separate Vitest node project because the current include patterns do not cover `testing/node`.

Runtime databases and generated evidence belong in ignored artifact locations. Tests use unique temporary directories. Do not place node databases, generated wallets or logs alongside authored package source. Never persist private keys in the evidence bundle.

## 6. Dependency and environment decisions

Initial candidate combination:

| Component | Candidate version | Verification status |
| --- | --- | --- |
| cardano-node | 11.0.1 | Upstream compatibility candidate; not tested locally in this review |
| Ogmios | 7.0.0 | Upstream compatibility candidate |
| Kupo | 2.12.0 | Upstream compatibility candidate |
| Lucid Evolution | Existing locked 0.6.4 | Reuse current workspace dependency |
| Aiken | Existing pinned 1.1.22 | Reuse compiler/build provenance |
| Plutus | Existing V3 projects | Use an appropriate actual ledger era |

References: [Kupo release](https://github.com/CardanoSolutions/kupo/releases/tag/v2.12.0), [Ogmios release](https://github.com/CardanoSolutions/ogmios/releases/tag/v7.0.0), [Cardano testnet tooling](https://github.com/IntersectMBO/cardano-node/tree/master/cardano-testnet).

Use the official Ogmios TypeScript client for protocol handling, subject to a compatibility spike against the pinned server. Pin the selected dependency in the lockfile. Do not write a custom WebSocket/JSON-RPC framework.

Use SQLite through `node:sqlite` as the initial journal candidate. Its basic APIs are available without the experimental flag from Node 22.13, matching the workspace engine floor, but the Node 22 binding remains experimental. Use only APIs available at that floor. Verify runtime and TypeScript compatibility before adopting it.

Sources: [Node SQLite](https://nodejs.org/download/release/latest-jod/docs/api/sqlite.html), [SQLite atomic commit](https://www.sqlite.org/atomiccommit.html), [SQLite synchronization](https://www.sqlite.org/pragma.html#pragma_synchronous).

For reproducibility, test at the minimum supported Node 22 version, a selected Node 24 release and a selected Node 26 release. This does not prove compatibility with every future version admitted by the current engine range. Record exact versions. If built-in SQLite fails this gate, propose one maintained compatible driver as a focused replacement; do not add an ORM or storage plugin framework.

After the spike passes, pin executable/container identities and retain the exact configuration. Match node, CLI and testnet tooling releases. Do not rely on mutable `latest` tags.

## 7. Accepted-chain interface and trust

Proposed adapter boundary:

```ts
type AcceptedEvent =
  | { kind: "forward"; block: AcceptedBlock }
  | { kind: "backward"; point: ChainPoint };

interface AcceptedChainSource {
  events(options: {
    intersections: readonly ChainPoint[];
    signal: AbortSignal;
  }): AsyncIterable<AcceptedEvent>;
}
```

The source adapter must disclose the negotiated intersection before subsequent events are applied. The runner can receive it through explicit session initialization or a narrowly specified control result. It must roll back its local history to that point before accepting forward events. Do not hide the selected intersection in an internal reconnect path.

### 7.1 Required behavior

1. Enable Ogmios `--include-transaction-cbor`.
2. Preserve complete transaction CBOR rather than rebuilding it from JSON.
3. Preserve ledger transaction order within each block.
4. Include phase-two-invalid transactions and their collateral effects.
5. Advance on empty blocks.
6. Preserve slot/hash identity; consecutive blocks need not have consecutive slots.
7. Use the preceding accepted cursor as `AcceptedBlock.parent`.
8. Check the supplied ancestor against that cursor where the selected schema provides it.
9. Serialize application even if transport requests are pipelined.
10. Bound queued data and apply backpressure.
11. Reject missing CBOR, malformed points or inconsistent history without partial publication.
12. Preserve original transaction bytes and IDs through evidence recording.

References: [Ogmios transaction schema](https://ogmios.dev/typescript/api/interfaces/_cardano_ogmios_schema.Transaction.html), [chain synchronization](https://ogmios.dev/mini-protocols/local-chain-sync/).

### 7.2 Bootstrap and origin

The current `ChainPoint` has a nonnegative slot and a 32-byte block hash. It does not represent Ogmios's literal `origin`.

For the first implementation, configure a real accepted intersection before the tested vault genesis. Deploy test vaults after that point. Starting after genesis must not yield an authenticated vault merely because its State is presently discoverable through Kupo.

If a live connection cannot serve the required history, fail with a clear incomplete-history disposition. Starting at tip, importing arbitrary balances or silently substituting an unauthenticated checkpoint is prohibited.

Origin support, authenticated historical imports and checkpoint bootstrap are separate API decisions. Do not use a fabricated zero hash as if it were a real origin block.

### 7.3 Network identity

Pin network name/ID, network magic, genesis artifacts, configured intersection, terms domain and reviewed script builds in the environment manifest.

Ogmios Shelley genesis configuration exposes network, magic and start time. It does not supply the original genesis-file hash. Compare the fields available from the server with the pinned manifest and hash the actual configured genesis artifacts. Hashing a returned JSON object is not equivalent to authenticating the original genesis file.

These checks still rely on the chosen node/endpoint and deployment configuration. Neither the adapter nor the reader becomes an independent consensus verifier.

### 7.4 Reconnect and rollback

On reconnect:

1. Offer retained points newest first.
2. Negotiate the common intersection.
3. Apply any necessary local rollback durably.
4. Resume from that intersection.

If no supported intersection exists, stop and require resynchronization from an earlier trusted point. A rollback before retained history must not be treated as a harmless no-op. The initial reference may replay from its configured earlier intersection; it must report that recovery is in progress rather than serve a current-looking partial view.

## 8. Durable journal and publication semantics

Use one SQLite schema containing:

- Schema/version metadata.
- Pinned network, reviewed build and bootstrap identities.
- Accepted block sequence, slot/hash and parent identity.
- Complete ordered transaction CBOR for each retained block.
- Durable current head.

Store large integer quantities/slots losslessly, for example as canonical decimal strings where appropriate. Do not route them through JavaScript floating-point numbers. Identity metadata must reject reopening with a different network, build or intersection unless an explicit rebuild creates a new journal.

Use a single writer, explicit transactions and durable synchronization. If WAL mode is selected, treat its companion files and checkpoint behavior as part of the database lifecycle. Never copy only the database file while assuming it contains every committed WAL transaction.

### 8.1 Forward publication

The required order is:

```text
receive accepted block
 -> prepare and validate reader update privately
 -> SQLite transaction: append history and update head
 -> commit
 -> publish prepared reader update
 -> acknowledge progress and allow reads
```

Extract a small prepare/publish boundary from existing reader staging if needed. It must preserve defensive copies and all existing checks. Do not calculate a separate projection in the chain package.

An alternative is a private serialized reader host that suppresses reads throughout tentative validation and storage, and restores from committed history on failure. Choose one approach during the spike; do not maintain both mechanisms. Prefer a narrow staged update if it avoids expensive full recovery on routine write failure.

### 8.2 Failure behavior

| Failure point | Required result |
| --- | --- |
| Projection validation fails | No journal or published-head change |
| SQL transaction fails | No proposed reader view exposed |
| Process dies before commit | Restart resumes from previous committed head |
| Process dies after commit, before publication | Restart replays committed history and reaches committed head |
| Publish fails after durable commit | Stop serving and reconstruct from committed journal |
| Journal unreadable or integrity check fails | Explicit unavailable/error state; no invented empty vault |

Duplicates caused by reconnect must be handled at the session/history boundary. Never weaken the reader's duplicate-transaction checks. Reuse of a block identity with conflicting contents must fail.

### 8.3 Rollback publication

Prepare the rollback against an exact retained point. Atomically truncate orphaned history and update the durable head, then publish the reconstructed view. Crash/restart must produce the same surviving branch and lifecycle as uninterrupted rollback.

Claims, requests, ownership and quote freshness reverse together. A delivery rollback restores the unspent claim. A settlement rollback removes its realized claim. A request becomes pending only if its creation remains on the surviving history.

## 9. Kupo, snapshots and transaction construction

Configure the installed Kupmios provider with `Accept: application/json:asset-quantity=string` for Kupo responses. Test quantities above `2^53` at the real transport boundary. Prefer raw CBOR for reader economics.

Kupo owns lookup of wallet outputs, datums and code-reference locations. The reader owns authenticated vault history and accounting. Do not make a second database that duplicates Kupo's queryable UTxO index.

### 9.1 Coherence rule

A snapshot and quote must derive from one reader view. A Kupo output from its latest tip cannot be inserted into an older snapshot and relabeled with that snapshot's block hash.

Additional wallet funding, collateral and reference-script outputs are construction prerequisites. Resolve and authenticate them separately under the existing effects/authorization boundary. Recheck relevant source identities and availability before signing, and rebuild if protected state or required evidence changed. These checks are not a reservation against future contention.

Expose reader progress and source availability separately from protocol snapshot semantics. A disconnected host can retain its last coherent historical view, but must not imply it is fresh enough for execution. Missing data must remain unknown or unavailable, not zero.

### 9.2 Construction sequence

1. Obtain authenticated context and a quote from the reader.
2. Create an existing family plan with user bounds and destinations.
3. Resolve wallet funding/collateral and reference scripts through Kupmios.
4. Balance using actual network parameters.
5. Evaluate compiled scripts through Ogmios.
6. Verify the complete body through existing wallet effects checks.
7. Sign with test-only wallets for the node test suite.
8. Submit exact signed bytes.
9. Observe inclusion through accepted chain-sync.
10. Compare realized state and outputs with the plan and independent node queries.

Submission success is not acceptance. An evaluation result is not inclusion. Do not mutate protected outputs silently to satisfy minimum ADA; replan explicitly.

## 10. Implementation phases and gates

Each phase ends with retained evidence. Do not start broad infrastructure work to compensate for a failed compatibility check.

### Phase 0: bind sources and run compatibility spike

Tasks:

- Record source hashes, current diffs, dependency locks and compiled build identities.
- Start a disposable appropriate-era local testnet with matching node/CLI tooling.
- Connect Kupo and Ogmios.
- Verify identity, real intersection, CBOR availability and safe quantities.
- Exercise installed Kupmios lookup, evaluation and submission.
- Prove one authentic genesis and one supported action can be included.
- Confirm `node:sqlite` and official Ogmios client compatibility.
- Establish a workload and resource budget for the later resource gate.

Exit gate G0: the chosen stack demonstrably serves the required bytes and executes one real authenticated flow. If the spike fails, record the incompatibility and resolve it before building the package.

### Phase 1: accepted-chain adapter

Tasks:

- Add the narrow adapter and provider configuration.
- Establish explicit initial/reconnected intersection handling.
- Add sequential processing, bounded buffering and cancellation.
- Capture real response fixtures with provenance.
- Verify no bytes, order, validity flag or collateral effects are lost.

Exit gate G1: deterministic replay and adapter tests pass, including missing/malformed data and discontinuity rejection without partial head advancement.

### Phase 2: durable runner

Tasks:

- Add journal schema, identity binding and atomic commits.
- Introduce only the necessary reader staging boundary.
- Replay on startup and serialize readers with publication.
- Handle write failure, interrupted shutdown, reconnect and rollback.
- Add process-level crash injection.

Exit gate G2: every crash boundary recovers to exactly the committed branch, and responses match clean uninterrupted replay.

### Phase 3: complete node lifecycle evidence

Tasks:

- Add the separate node test project and disposable environment wiring.
- Execute CTVS-1 direct operations and applicable maintenance.
- Execute CTVS-2 requests, batches, claims, delivery and recovery.
- Cover ADA and real locally minted native underlying assets.
- Record actual parameters, evaluation, signing, inclusion and output readback.
- Exercise meaningful negative cases with the intended rejection reason.

Exit gate G3: supported advertised flows reach the actual ledger and indexed results reconcile with independently queried UTxOs and effects. Local emulator acceptance alone cannot satisfy this gate.

### Phase 4: real rollback and resources

Tasks:

- Produce a controlled node fork/rollback and replacement branch.
- Observe actual Ogmios rollback messages and Kupo branch catch-up.
- Verify reader reversal, restart and stale-response behavior.
- Benchmark the declared mixed workload and recovery costs.
- Document limits and resynchronization behavior.

Exit gate G4: actual rollback interoperability is demonstrated, and measured costs fit predeclared limits. If a real rollback cannot be produced reliably, keep that gate incomplete. If resource limits fail, propose a separate checkpoint/filtering design rather than claim production suitability.

### Phase 5: independent conformance and final review

Tasks:

- Have a separate decoder/indexer interpret the same recorded chain bytes and rollback.
- Obtain independently constructed representative transactions from public specification and authenticated data.
- Compare quantities, lineage, fees, outputs and accepted effects.
- Run the full existing gate plus node gates against the final source manifest.
- Review package boundaries, dependencies and specification traceability.
- Update validation records with exact scope and remaining limitations.

Exit gate G5: independent obligations are met for the claimed operations, or explicitly remain open. Two wrappers around the same reader or construction implementation do not satisfy this gate.

## 11. Detailed verification matrix

| ID | Scenario | Required assertion |
| --- | --- | --- |
| C-01 | Real forward block | Slot/hash, parent and ordered complete CBOR retained |
| C-02 | Empty block and skipped slots | Cursor advances correctly without fabricated transactions |
| C-03 | Missing CBOR, bad point or wrong ancestor | Block rejected; previous coherent head remains |
| C-04 | Multiple messages/pipelining | Application order preserved; queue stays bounded |
| C-05 | Disconnect and reconnect | Common intersection applied before new forward events |
| C-06 | Unavailable/deeper intersection | Explicit stop/resync; no tip jump or partial current view |
| C-07 | Large token quantities | No floating-point loss or unsafe numeric acceptance |
| C-08 | Phase-two-invalid accepted transaction | Only actual collateral effects projected; ordinary State/Claim outputs absent |
| C-09 | Wrong network/build identity | Startup fails before history is served |
| J-01 | Successful append and rollback | Event/history and head commit atomically |
| J-02 | Crash before/during commit | No partial durable head |
| J-03 | Crash after commit before publication | Startup reconstructs committed head exactly |
| J-04 | Invalid reader transition | Invalid block never becomes durable accepted history |
| J-05 | Disk failure or unreadable journal | Unavailable state; no fabricated empty/zero result |
| J-06 | Duplicate/conflicting history | Harmless reconnect reconciled; contradictory bytes rejected |
| J-07 | Restart with different identity | Reject journal reuse unless explicit fresh rebuild |
| R-01 | Genuine vault genesis | Share lookup resolves reviewed scripts, terms and authentic origin |
| R-02 | Config/State/Claim lookalikes | No conformance or entitlement inferred from address/datum alone |
| R-03 | Quote versus accepted result | Estimate, submission and realized effect remain distinct |
| R-04 | Ownership across async lifecycle | No double-counting escrow, participating shares or fixed claims |
| R-05 | Mixed Kupo/reader progress | Snapshot cannot silently combine incompatible bases |
| N-01 | CTVS-1 four direct operations | Ledger inclusion, exact custody/supply and receiver effects |
| N-02 | Fees, reserve top-up and pause | Existing maintenance and authority semantics preserved |
| N-03 | CTVS-2 deposit/redeem lifecycle | Request, settlement, funded claim and delivery reconcile |
| N-04 | Mixed batch and zero-net mint | Gross issue/extinction and per-request allocations enforced |
| N-05 | Cancellation and expiry | Recovery works with unavailable batcher and unsupported economics where specified |
| N-06 | Native underlying asset | Real local minting and custody tested, not synthetic initial balance alone |
| N-07 | Stale or spent sources | Fresh discovery/rebuild required; signed bounds preserved |
| N-08 | Wrong recipient/output reuse/balanced theft | Intended compiled guard rejects the candidate |
| N-09 | Missing authority/forbidden withdrawal | Intended ledger or effects restriction remains enforced |
| B-01 | Actual delivery rollback | Claim restored and receiver ownership reversed |
| B-02 | Actual settlement rollback | Realized claim removed; surviving request status reconstructed |
| B-03 | Replacement branch | Only replacement-chain effects remain |
| B-04 | Rollback followed by process restart | Journal and reader agree on exact branch and head |
| P-01 | Representative mixed load | Resource measurements stay within declared limits |
| I-01 | Independent decoder/indexer | Exact fields, origin, lifecycle and rollback agree |
| I-02 | Independent construction | Same permitted effects derived without calling first builder |

Use deterministic properties for event sequences, replay equivalence and commit-boundary recovery where they add coverage. Preserve existing fixed seeds/run counts and minimize failing traces. Do not add assertions that merely repeat the implementation's arithmetic.

Accepted phase-two-invalid evidence should come from actual node history or a provenance-bound real corpus. Fabricated CBOR is useful as an adversarial fixture, but cannot prove the node included that transaction.

## 12. Concrete CTVS-2 acceptance trace

Use the existing fixture whose `101,000,000` underlying-unit deposit quotes `100,000,000` share units after its `1,000,000` economic fee. Preserve its actual Terms and virtual accounting parameters. These quantities are fixture-specific, not a universal exchange rate.

1. Start chain-sync at a real point preceding deployment.
2. Publish actual scripts and create authenticated Config/State.
3. Discover the share asset through accepted genesis history.
4. Request the indicative deposit quote; record its point and State source.
5. Submit a funded Request with the user's minimum and destinations.
6. Observe accepted request creation. Escrow is not participating backing yet.
7. Execute the authorized Batch using the consumed snapshot.
8. Observe issued shares in a correctly funded Claim; they are issued but not delivered.
9. Deliver the Claim to the protected receiver and verify free share ownership.
10. Restart the process and compare all public response fields with uninterrupted replay.
11. Produce a real rollback of delivery; restore the unspent Claim and reverse delivery attribution.
12. Roll back settlement; remove the Claim and reconstruct the Request only if it survives.
13. Follow a replacement branch containing valid cancellation where the request remains spendable.
14. Verify exact asset return, lifecycle, ownership and stale quote behavior.

Repeat the relevant lifecycle for redemption. Test fees, storage/carry, top-ups and supply separately so rounding or storage ADA cannot hide a custody discrepancy.

## 13. Resource and operating envelope

Before the benchmark, declare:

- Number of vaults, observed wallets and retained blocks.
- Total transactions, unrelated outputs and average/worst transaction sizes.
- Forward-event rate and maximum burst queue.
- Maximum intended rollback depth.
- RSS, journal disk usage and block-application latency limits.
- Maximum restart and rollback recovery times.
- Test hardware/runtime and protocol-parameter snapshot.

Measure at increasing retained-history sizes. Full-projection copying and prefix replay can worsen as history grows; a short throughput sample alone is insufficient.

For the controlled reference host, enforce explicit input/workload limits and fail clearly when exceeded. Do not silently prune required lineage or ledger events to meet a memory target.

Before continuous production use, the current growth behavior needs a separate bounded-resource design. Any filtering/checkpoint proposal must preserve genesis authentication, share ownership, recovery evidence, unrelated effective inputs needed by the projection, and supported rollback. Durable SQLite alone is not that design.

Do not change active network transaction limits to make tests pass. Measure actual minimum ADA, fees and execution units. The previously measured CTVS-2 publication had little size headroom; its old measurement cannot substitute for the final network-parameter run.

## 14. Evidence, commands and reporting

Existing reproduction command from `reference`:

```sh
VITEST_MAX_WORKERS=4 npm run check
```

Configure the pinned Aiken compiler as documented. The node gate will be a new explicit script, proposed as `npm run test:node`; that command does not exist yet. A configured node job must fail when its environment is unavailable, rather than silently skip while reporting success.

Evidence for each run should retain:

- Source hashes, working-tree diff and dependency locks.
- Compiler, CLI, node, Ogmios, Kupo and runtime versions/digests.
- Network/genesis configuration and real bootstrap point.
- Reviewed script hashes and original compiled code provenance.
- Active protocol parameters and era.
- Original signed CBOR, transaction IDs and actual block points.
- Evaluation results, declared/actual execution units and fees.
- Witness verification disposition and collateral/return.
- Expected versus observed outputs, custody and supply.
- Journal commit/crash boundaries and recovered heads.
- Node rollback messages and replacement-branch records.
- Resource workload, thresholds and measurements.
- Independent comparison results and identity of the separate implementation.

Generated evidence belongs under `reference/artifacts/chain` or `reference/artifacts/node`. Commit a compact source-bound summary and deliberately selected replay fixtures under a dated review record when implementation is verified. Do not commit private keys, endpoint credentials or large runtime databases.

## 15. Code quality and scope review checklist

- One economic engine, one protocol projection, one configured transaction provider.
- No imports from testing code into production packages.
- No transport or filesystem dependencies introduced into pure protocol/planning packages.
- Comments explain authority, units, mutation and failure boundaries.
- Existing complexity limit 15, maximum depth 4 and function length 100 remain enforced.
- Existing coverage thresholds remain 90% lines/statements/functions and 85% branches.
- New production files enter coverage even if a test does not import them.
- No lint exclusions, lowered property counts or skipped cases used to conceal failures.
- No generic abstraction without a demonstrated second use or specification obligation.
- No public API server or supported builder promise inferred from a CLI/test harness.
- Existing user modifications remain preserved and identifiable in validation manifests.
- Full tests and focused new gates run against the final sources, not an earlier intermediate tree.

## 16. Price integration follow-up, explicitly outside this delivery

The optional Price interface is already discussed in the current whitepaper and isolated example. This chain backend can provide the data access needed by a future provider transaction. It does not enable that transaction inside the current direct-custody vaults.

A separately scoped Price acceptance effort would need:

1. A native-state discovery recipe and approved provider binding.
2. Off-chain Price encoding matching the Aiken wire type.
3. Actual compiled provider code with verified identity, through a witness or reference-script output.
4. Authenticated evidence UTxOs supplied as reference inputs.
5. A zero withdrawal invoking the provider with the claimed assertions.
6. A consumer reading that exact redeemer and enforcing its own custody/output obligations.
7. A signed, balanced, node-accepted transaction executing both actual purposes.
8. Wrong provider, wrong market/assets, stale/replaced evidence, duplicate/unsupported assertions and theft rejection tests.
9. Mixed decimals, source scales, fractional conversion and exact-output rounding vectors.
10. Signed subject/scale/freshness tests only for providers that advertise signed evidence.
11. Measured resources and independent wire/construction evidence for the advertised capability.

Evidence is data, not executable code. A pointer to a market-state UTxO neither fetches it remotely nor invokes the provider. A code-reference output makes compiled code available; invocation is through the script purpose. Preserve that distinction in tests and documentation.

Debt belongs in the applicable managed-vault accounting profile, not in a new generic indexer formula. A conversion can value one receipt holding without proving the entire vault's net backing, liabilities or liquidatable balance.

Enabling provider withdrawals in current vault transactions requires a separate reviewed allocation/composition policy and matching planner, Aiken and wallet-effects changes. It must not be achieved by globally relaxing the prohibited-purpose list during this integration.

## 17. Completion checklist

- [ ] G0: stack, identity, CBOR and one authentic node action proven.
- [ ] G1: accepted-chain adapter contract and deterministic replay proven.
- [ ] G2: durable restart and crash/rollback publication proven.
- [ ] G3: complete advertised current-profile node lifecycles and intended rejection cases proven.
- [ ] G4: actual node rollback and declared resource envelope proven.
- [ ] G5: independent decoder/indexer and construction evidence recorded for any broader conformance claim.
- [ ] Existing complete test gate passes without weakening thresholds or skipping cases.
- [ ] Documentation clearly separates verified results, reference limits and open gates.
- [ ] Final filesystem/dependency review confirms no duplicate engines or unrelated features.

At plan creation, every checkbox remains open. Implementation may establish narrower intermediate milestones, but must not report an uncompleted gate as verified or transfer evidence to unsupported native/managed profiles.
