# Reference indexer

`@ctvs/indexer` hosts the existing `@ctvs/integration` reader. It accepts ordered Ogmios chain events, commits their original transaction CBOR and cursor to SQLite, then publishes the prepared reader update. Restart replays durable history; every connection negotiates a retained intersection before the reader becomes ready.

The service provides validated startup, all/selected tracking, durable replay and rollback, workload limits, operational HTTP endpoints, all six economic views and the versioned application/transaction-data query API. Its typed HTTP client is stateless. The [implementation plan](../../../docs/chain-integration-plan.md#17-completion-checklist) is the current source for completion and acceptance gates; the [node guide](test/node/README.md) describes executable scenarios and links their dated evidence.

## Complete local stack

Run from this directory:

```sh
cp .env.example .env
cp config/indexer.example.json config/indexer.json
```

Edit both copies before startup. The example deliberately contains invalid placeholders. In `.env`, set `NODE_CONFIG_DIR` to an absolute directory containing the intended node's `config.json`, `topology.json` and original genesis files. Genesis paths in the node configuration must resolve inside the `/network` mount. Set `INDEXER_CONFIG` to the absolute path of your edited `config/indexer.json`.

| Configuration field | Required value |
| --- | --- |
| `network` | Explicit name, network ID, magic, SHA-256 of original Shelley genesis file bytes, and 32-byte Terms network domain |
| `genesisPath` | Original Shelley genesis path; `/network/shelley-genesis.json` in Docker if that is its actual filename |
| `intersection` | Real accepted `{slot, blockHash}` preceding every vault genesis to authenticate; slot is a decimal string |
| `reviewedBuilds` | One reviewed build per enabled family with build ID, unapplied vault template CBOR, Config script and Claim script bytes |
| `tracking` | `{"mode":"all"}` or `{"mode":"selected","vaults":["<56 hex policy ID>"]}` |
| `database` | `/data/indexer.sqlite` in Docker; otherwise a local path relative to the configuration file |
| `sources` | Container endpoints from the example; HTTP(S) without embedded credentials or query parameters |
| `kupoCoverage` | Optional operator declaration `{"since":"origin","match":"*","spent":"retain"}` for the endpoint's complete database history; omit or set null to disable lookup readiness |
| `http` | Example container listener; Compose publishes it on host loopback |
| `limits` | Explicit operating envelope; omitted individual fields use the defaults below |

Use the reviewed build manifest and blueprint together to supply program bytes. A build label alone does not authenticate deployed scripts. CTVS-1 requires `claim: null`; CTVS-2 requires the reviewed Plutus V3 Claim script. Obtain original genesis SHA-256 with `shasum -a 256 /absolute/path/to/shelley-genesis.json`.

The loader checks the original genesis hash, magic, network ID and start time. Ogmios's served Shelley genesis must agree on magic, network ID and start time. This does not remotely verify every genesis byte. Bind upstream services to the same pinned node/socket and configuration mounts. Ogmios must serve the requested intersection and include complete transaction CBOR. There is no origin or latest-tip fallback.

```sh
docker compose config --quiet
docker compose up --build -d
docker compose logs -f indexer
curl http://127.0.0.1:18080/status
curl -i http://127.0.0.1:18080/health/ready
```

`compose.yml` runs Cardano node, Ogmios, Kupo and the indexer. It pins node 11.0.1, Ogmios 7.0.0 and Kupo 2.12.0 by image digest. The indexer image pins Node 22.20.0 and runs as the `node` user. Its build context is `reference/`, so workspace libraries resolve without publishing packages. Named volumes persist the node database, Kupo database and indexer journal. `docker compose down` retains them.

Kupo starts at origin with `--match "*"`, independently of vault tracking, and retains broad output coverage without pruning. This conservative local configuration can be expensive on a public network. The workload below is for controlled reference runs. The controlled G0 stack passes; representative network load and full lifecycle acceptance remain unverified.

## Existing node

Use the standalone `compose.existing-node.yml` instead of the default file:

```sh
NODE_SOCKET_DIR=/absolute/path/to/socket-directory \
  docker compose -f compose.existing-node.yml config --quiet
NODE_SOCKET_DIR=/absolute/path/to/socket-directory \
  docker compose -f compose.existing-node.yml up --build -d
```

`NODE_SOCKET_DIR` must contain `node.socket`. Both upstream containers mount it explicitly at `/ipc`. Ogmios, Kupo and the indexer mount `NODE_CONFIG_DIR` at `/network`. Use the existing node's actual original configuration/genesis files. The platform must support access to that Unix socket; a bind mount alone does not establish socket compatibility across a VM boundary.

## Local process

Use a supported workspace Node version; Node 22.20.0 is the pinned container runtime. Run `npm ci` from `reference/`, then launch from this directory:

```sh
CTVS_INDEXER_CONFIG=./config/indexer.json npm run start
```

For a local process, change endpoints to the published host ports, `genesisPath` to the local original file, `database` to an ignored path such as `../data/indexer.sqlite`, and listener host to `127.0.0.1`. Relative file paths resolve against the configuration file's directory. From `reference/`, use `CTVS_INDEXER_CONFIG=/absolute/path/to/indexer.json npm run start:indexer`.

## Status and consistency

HTTP endpoints are read-only and send `Cache-Control: no-store`. Ledger integers and slots serialize as decimal strings.

| Endpoint | Behavior |
| --- | --- |
| `GET /health/live` | 200 while the status process is listening |
| `GET /health/ready` | 200 only when the reader is reconciled and within configured lag; otherwise 503 |
| `GET /status` | Phase, durable/reader heads, observed tip, recovery generation, scope, counts, limits and Kupo reconciliation reason/basis |

The query endpoints below use their own method and validation rules. Other paths return 404; unsupported methods return 405. Within the host, `Runner.read(callback)` executes synchronous existing reader queries against one published view and rejects reads during replay, recovery, lag or disconnection. Network lookups cannot be awaited inside the callback.

`readerReady` requires agreement between durable and published heads. Default `maxLagSlots: 0` requires reaching the observed node tip. An independent Ogmios tip query runs every `requestTimeoutMs`; a timeout closes the connection and triggers reconciliation. An idle silent connection can take up to two request intervals to detect, excluding event-loop delay. Transport failures retry after `reconnectDelayMs`. The official SDK's initial HTTP health/handshake operation has no cancellation API, so its timeout stops the process instead of accumulating pending connection attempts. Malformed chain data, incompatible network/intersection, journal failure or exceeded budget also stops the process.

`lookupReady` requires a successful bounded Kupo 2.12.0 probe at the reader's exact observed tip, even if `maxLagSlots` permits older reader results. The probe reads connected health, the committed `/checkpoints` head, `/patterns`, the committed head again, then health again. Every checkpoint payload and applicable health header must match the reader's slot and block hash; Kupo's reported node tip must also match. Same-slot forks, ahead/behind checkpoints, rollback in progress, unsupported versions and missing wildcard coverage keep it false. Kupo updates health before its SQLite commit, so headers alone cannot establish committed progress. Both database payload reads are required.

Readiness is an expiring observation, not a reservation or an atomic snapshot for a later network lookup. It is bound to service instance, recovery generation and exact committed point. It becomes false immediately when that binding changes, while a new probe is running, on probe failure, or when `lookupMaxAgeMs` elapses from probe start. The default age is 10,000 ms, with a maximum of 60,000 ms. Timeouts bound the whole probe, each response is limited to 65,536 bytes, and redirects/conditional cache responses are rejected. Process restart carries no proof from the journal. `/status.kupo` reports `verification`, `reason`, `checkedAt`, `maxAgeMs`, `basis` and the last observed reachability. `/health/ready` and every existing SDK read still depend only on reader readiness.

The optional `kupoCoverage` declaration is a trusted deployment assertion, not a fact inferred from a successful empty query or current patterns. Kupo's API cannot prove its original start point, uninterrupted historical pattern coverage or pruning history. The bundled stack satisfies the declared settings when its database starts fresh: origin, exactly `--match "*"`, no pruning, the same pinned node/socket/configuration, and no external pattern/database mutation. Preserve these conditions for the database's entire lifetime. An old narrow or pruned database cannot be repaired by adding the declaration; rebuild it from origin. Omit the declaration for an endpoint whose history you cannot establish. Coverage is independent of all/selected vault tracking. Changing endpoint or coverage always requires new observations and does not change the economic journal identity.

The query API currently returns reader data only. It adds no Kupo outputs, signing endpoint or submission endpoint. A future lookup inclusion must verify the actual lookup response and its point compatibility within that operation; polling `/status` first is insufficient. Installed Kupmios requests string asset quantities with `Accept: application/json;asset-quantity=string`, verified against the pinned server above `2^53`, but its ordinary latest-tip methods are not a point-compatible query API.

The instance ID changes on restart. Recovery generations change on intersection, rollback and disconnection. Queries return this identity in `basis` alongside the committed chain point and pricing State reference. `expectedBasis` requires exact equality on a subsequent read. It does not reserve inputs or prevent a response becoming stale after delivery.

## Application queries and SDK

Use the private workspace export `@ctvs/integration/client`; no separate SDK installation or package publication is implied. Pin `expectedNetwork` to the same reviewed network binding as the service configuration, including genesis hash, magic and Terms domain.

```ts
import { createIndexerClient } from "@ctvs/integration/client";

const client = createIndexerClient({ baseUrl: "http://127.0.0.1:18080", expectedNetwork });
const vault = client.vault(policy);
const view = await vault.read({
  snapshot: true,
  convertToAssets: { shares: 100_000n },
  previewDeposit: { assets: 101_000n, include: ["construction"] },
  ownership: { address },
});
// All requested data comes from one committed reader callback and one HTTP request.
const preview = view.data.previewDeposit;
if (preview.result.status === "known") console.log(preview.result.value); // bigint shares
console.log(preview.availability, preview.fees, view.basis);
```

Individual calls are `vault.snapshot()`, `convertToAssets({shares})`, `convertToShares({assets})`, `previewDeposit({assets})`, `previewMint({shares})`, `previewWithdraw({assets})`, `previewRedeem({shares})`, `ownership({address})`, `context()`, `request({ref})`, `claim({ref})` and `recoverySource({ref})`. Each returns a common envelope with its result under `data`; `read({...})` returns a keyed `data` object. `client.discover(policy + ".5348415245")` returns an authenticated snapshot under `data.snapshot`. There are no browsing/list endpoints.

Conversions round down without operation fees. Deposit/redeem previews floor outputs; mint/withdraw previews ceil required inputs with the existing fee ordering. `result` is an observation; `quote` carries gross/net assets, shares and protocol fee for previews. `units` and `feeUnits` identify quantities; `protocolFeeDestination` identifies the immutable configured fee recipient. `constructionMaximum` remains unknown until a complete transaction is evaluated. Network fee, execution charge, storage/carry and top-ups remain explicitly unknown until construction. A pause or cap can leave valid arithmetic with unavailable execution. CTVS-2 previews are indicative until settlement; mint/withdraw construction and execution are unsupported.

```ts
const first = await vault.snapshot();
const next = await vault.read({ context: true }, { expectedBasis: first.basis, signal });
```

An expected basis binds instance, recovery generation, exact committed point and pricing State reference. Any changed field rejects the entire read with `STALE_BASIS`, even after an empty block. Disconnect/replay/reconciliation returns `READER_NOT_READY`. The client validates the configured network, transport version, result keys/units and shared evidence, preserves bigint/bytes and performs no retries. Its runtime import graph contains only client/query modules. HTTP authentication and independent ledger validation are outside this client; keep the reference listener on the documented loopback binding.

### Wire contract

| Endpoint | Behavior |
| --- | --- |
| `POST /v1/vaults/{56-hex-policy}/read` | One or more named read fields; all succeed or an error is returned without data |
| `GET /v1/discover?share={policy}.5348415245` | Exact SHARE discovery, returning the same snapshot/basis envelope |

```json
{"apiVersion":"CTVS-QUERY-1","queries":{"previewDeposit":{"assets":"101000","include":["construction"]},"context":true}}
```

Send `Content-Type: application/json`. Optional `expectedBasis` is a top-level request field. The transport version is `CTVS-QUERY-1`; the enclosed semantic schema remains `CTVS-INTEGRATION-0.6`. Ledger quantities, slots and output indices are canonical decimal strings; safe counts/network discriminants are JSON numbers, hex is lowercase, and original inline datum CBOR is `datumCbor`. Semantic destination Data uses explicit integer/bytes/list/constructor/map variants with ordered map pairs. The shared `@ctvs/integration/query` codecs define the complete contract; generic JSON bigint revival is unsafe.

Requests are limited to 64 KiB and 12 subqueries, responses to 1 MiB, and request-body reception/client operations to 10 seconds. The client supports an `AbortSignal` and configurable timeout. These bounds supplement operating quotas and do not establish a production latency guarantee. Reader evaluation is synchronous and cannot be interrupted midway; it performs no remote lookup. Oversized or stalled bodies fail before dispatch; oversized responses return no result data.

Errors use `{apiVersion, error: {code, message}}`. Malformed inputs are `INVALID_REQUEST` (400, or 405/415 for method/content type); `READER_NOT_READY` is 503; `OUTSIDE_SCOPE` is 403; `HISTORY_INCOMPLETE` and exact-ID `NOT_FOUND` are 404; `STALE_BASIS` is 409; `UNSUPPORTED_CONSTRUCTION` is 422; `QUERY_LIMIT` is 413 or 408 for body timeout. Incomplete authenticated history does not prove a vault does not exist. Valid unknown/unsupported/not-applicable observations remain data. Malformed or incompatible remote responses become client `INVALID_RESPONSE`/`NETWORK_MISMATCH`, rather than successful empty values.

### Caller-side transaction plans

Previews optionally include `construction`; `context()` supplies it separately. Obtain related context and Request/Claim sources in one combined read when building a batch. Context contains reviewed deployment/Terms, Config reference and the current protected State's complete value/address/original datum CBOR. Historical Request/Claim reads retain `unspent`; `toPlannerInput` rejects an already consumed source.

```ts
import { toPlannerContext } from "@ctvs/integration";
import { buildDirectPlan } from "@ctvs/ctvs1";

const view = await vault.previewDeposit({ assets: 101_000n, include: ["construction"] });
const source = view.data.construction;
if (!source) throw new Error("construction unavailable");
const plan = buildDirectPlan({
  ...toPlannerContext(source, "ctvs1"),
  operation: "deposit",
  amount: 101_000n,
  bound: 100_000n, // Caller-approved minimum shares, never inferred from a later quote.
  receiver,
});
```

For CTVS-2, feed `toPlannerContext(view.data.context, "ctvs2")` and `toPlannerInput(view.data.request)` into the existing `buildBatchPlan`. Claim delivery uses `toPlannerInput(view.data.claim)`. An unspent `recoverySource()` returns the original opaque CBOR and complete value directly for the family `buildRefundPlanFromCbor`, preserving refund mode/validity supplied by the caller. Unsupported economic bodies need not be decoded to refund. The [planner handoff tests](test/unit/planner-handoff.test.ts) exercise direct operations and Request, Batch, delivery and refund flows through the HTTP client.

A context is observed data, not a reservation or ready transaction. Callers still provide bounds, destinations, authority and validity intervals, then resolve funding/collateral/reference scripts, balance/evaluate, approve effects, sign and submit through existing libraries. Refresh after rollback or State consumption. The query service has no signing/submission endpoint and supplies no Kupo-derived construction enrichment.

## Storage, scope and limits

The journal binds network/genesis identity, Terms domain, reviewed program bytes, tracking scope and bootstrap. It refuses silent identity/scope changes. Endpoints, file locations and budgets can change without changing that identity. To change scope or bootstrap, stop the process and explicitly choose a new database/volume, preserving the old journal if needed. No automatic destructive rebuild exists.

SQLite uses WAL and `synchronous=FULL`. A forward update is prepared privately, history and head commit together, then the update publishes. Rollback privately reconstructs the retained prefix, atomically truncates orphaned history and updates the head, then publishes. A crash after commit but before publication is repaired by replay. Rollbacks outside retained history fail explicitly.

Selected tracking filters authenticated vault installation by policy ID. It still preserves transactions and ordinary outputs needed to follow ownership outside vault addresses. Kupo's independent broad lookup pattern is unchanged by this setting.

| Budget | Default |
| --- | --- |
| Retained blocks | 2,000 |
| Retained transaction IDs | 10,000 |
| Effective unspent outputs, including unrelated outputs | 20,000 |
| Vault, Request and Claim records combined | 20,000 |
| Raw transaction bytes per accepted block | 2,000,000 |
| Retained serialized history bytes | 64,000,000 |
| Allowed observed slot lag | 0 |
| Setup/query timeout and tip-query interval | 10,000 ms |
| Reconnect/health-poll delay | 3,000 ms |
| Maximum age of a Kupo readiness observation | 10,000 ms (configurable up to 60,000 ms) |
| Kupo reconciliation response bytes | 65,536 per response |

History bytes measure serialized event bodies, not physical SQLite/WAL size. These are refusal thresholds, not measured memory or latency guarantees. The reader still clones its projection and replays history for rollback. It does not prune or provide checkpoint bootstrap. Reaching a budget requires an explicit operator decision and measured capacity, rather than silently dropping history.

## Verification

From `reference/`:

```sh
npm run typecheck
npm run test:indexer
npx vitest run --project unit packages/integration/test --reporter=default
npm run test:coverage
npm run test:integration
```

Unit tests use real SQLite, fresh-process abrupt WAL exits, installed Kupmios and the official Ogmios client over a synthetic local HTTP/WebSocket server. They cover publication faults, replay, rollback replacement, reconnect, idle-tip lag, all six SDK methods over HTTP, request/response budgets, timeout/cancellation, exact codecs and caller-side planner handoff. The [19 October verification](../../../docs/reviews/2026-10-19-sdk/README.md) records the SDK results. Fabricated headers and fixture transactions do not prove real-node acceptance.

Run `npm run test:indexer:node` from `reference/` for the separate opt-in node project. It rebuilds contracts, generates fresh magic-42 networks, records real evaluations/accepted CBOR/readbacks and stops its owned resources. The [node guide](test/node/README.md) documents scenario filters, ports, evidence and cleanup; the [test layout](test/README.md) explains shared support and fixtures. Consult [Section 17 of the implementation plan](../../../docs/chain-integration-plan.md#17-completion-checklist) for current completion status. Dated verification records retain their original source paths and results.
