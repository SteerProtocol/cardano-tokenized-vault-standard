# Authenticated integration reference

`@ctvs/integration` exposes coherent discovery, snapshots, quotes, Request/Claim lifecycle, ownership and constructed effects for both independently compiled families. It reuses protocol economics/wire decoding and Lucid/CML transaction decoding, hashing and script parameter application.

## Trust and input boundary

Construct `VaultReader(networkBinding, reviewedBuilds, intersection)`. Pin the exact reviewed script templates and build IDs, and bind the accepted-block source to the intended network's genesis hash, network magic, address network ID and Terms network domain. Address network ID zero alone cannot distinguish test networks.

Feed `rollForward({parent, point, transactions})` with raw CBOR for every accepted transaction in ledger order, including phase-two-invalid transactions. Feed `rollBackward(point)` on rollback. An accepted-block adapter, such as a node-backed chain-sync service, owns consensus acceptance and header/network verification. Mempool events and arbitrary explorer responses are not accepted-chain evidence. The reader does not verify consensus or manufacture evidence that a caller's block was accepted. No HTTP client, custom ledger, hosted indexer or database is embedded here.

Start the intersection before the vault's genesis. Discovery requires the authentic ID output, consumed parameter seed, Config commitment, parameter-applied P hash, reviewed F/Q hashes, exact initial State and immutable network binding. A copied Config datum without ID is ignored. Vaults whose genesis is absent remain undiscovered; a supplied policy alone never authenticates them.

This reference keeps an in-memory journal and replays the retained prefix on rollback. Blocks apply atomically. A rollback before the intersection fails explicitly and requires an earlier restart. Persist accepted events externally for durable restart; this package does not claim bounded-memory production indexing. Complete accepted history after authenticated genesis makes the tracked SHARE ownership projection coherent.

## Public responses

All response methods carry `CTVS-INTEGRATION-0.6`, kind, network, chain point, vault/build/profile/wire identities, source references and verification disposition. `responseToJson` serializes bigint quantities as decimal strings and bytes as hex. `responseStatus` marks responses stale when their chain point or authenticated genesis no longer matches.

| API | Result |
| --- | --- |
| `discover(policy + "." + NAMES.share)` | Authenticated vault snapshot from exact SHARE identity |
| `snapshot(policy)` | Backing, supply, excluded fees/reserve, custody liquidity, modes and pause state in raw ledger units |
| `quote(policy, operation, amount)` | Exact snapshot arithmetic, current economic availability, separate protocol/network/settler fees, pricing evidence and construction prerequisites |
| `request(policy, ref)` | Recognized origin, request validation, lifecycle participation, recovery conditions and settlement/completion evidence |
| `candidate(policy, ref)` | Distinguishes an unsupported recovery envelope from a recognized recovery with unsupported economics, without creating a liability |
| `claim(policy, ref)` | Funded Claim with actual Batch allocation and Request/State lineage; look-alikes are rejected |
| `ownership(policy, address)` | Free shares, redemption escrow, issued undelivered shares, pending deposits and fixed asset Claims separately |
| `context(policy)` | Current authenticated context for the existing family planner |
| `recoverySource(policy, ref)` | Unspent protected metadata and raw datum for `buildRefundPlanFromCbor`; no full economic-body decoding |
| `effects(policy, cbor, plan, authorization)` | Complete pre-signing approval, bound to this reader's current chain point, reviewed deployment and indexed protected inputs |

Pending ownership uses the refund destination; Claim ownership uses the fixed delivery destination. Controller authority is returned separately as `controlledRequests`. A named controller is not proof of economic ownership or creator consent. Pointer addresses are not equated with enterprise addresses. Unsupported candidates are identified without assuming rescue rights.

Async quotes are indicative until settlement; immutable Claim quantities are realized at settlement and never repriced during delivery. Deposit maximum reuses the existing economic solver. Other operation-specific maximum solvers and constructed transaction capacity explicitly return unknown. Unknown fee/capacity values never become zero. A quote does not promise execution, witness availability or future settlement.

`effects` authenticates protected inputs against the indexed UTxOs. External wallet funding/collateral and additional reference-script inputs still require authenticated evidence in `WalletAuthorization`, especially when they predate the reader's intersection.

The envelope implements the supplied PDF's common semantic fields. The historical external `response.schema.json` bundle was unavailable, so exact compatibility with that unpublished JSON schema is not claimed. The two standard clients remain separate; this package is their shared reader and response boundary.

## Cardano and acceptance evidence

CML retains original transaction-body encodings for hashing. Spend redeemers resolve against canonical TxIn ordering. Reference inputs are not consumed. A phase-two-invalid transaction consumes collateral and creates only its [CIP-40](https://cips.cardano.org/cip/CIP-0040) collateral-return output at index `ordinaryOutputs.length`; its ordinary outputs cannot create State or Claims. A real collateral-return Request can still be recognized for recovery.

`test/` uses explicitly synthetic accepted-event fixtures to test reader semantics and malformed evidence. `testing/integration/ctvs2/reader.test.ts` replays actual locally signed and evaluated transactions from the separately compiled contracts. It tests delivery rollback, settlement rollback, funded look-alikes, and an accepted cancellation on a replacement local branch. Block points and fork restoration are explicitly local test fixtures. No cardano-node rollback, public-network deployment, independent consensus verification or independent indexer interoperability is claimed.
