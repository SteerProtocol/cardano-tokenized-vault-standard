# Disposable node acceptance tests

From `reference/`, with Docker Desktop running and pinned Aiken 1.1.22 on PATH:

```sh
npm run test:indexer:node
```

This explicit opt-in command rebuilds both contract families, selects the separate `node` Vitest project, generates fresh magic-42 test keys/genesis and starts the pinned node/Ogmios/Kupo/indexer stack. Twenty-eight scenarios run: ADA/native lifecycle, maintenance and maintenance rollback cases for each family, CTVS-2 ADA/native mixed-batch and mixed-batch rollback cases, CTVS-2 ADA deposit recovery, CTVS-2 native deposit and redemption recovery, CTVS-1 native direct recovery, intended rejection cases for both families and asset modes, and four G1 real-response/reconnect/included-failure cases. Each case uses a fresh network. It fails if required tooling or endpoints are unavailable. Normal `npm run check` remains offline and does not launch this project. The [test layout](../README.md) separates live infrastructure, scenarios and passive evidence utilities. Current project completion and open gates live in [Section 17 of the integration plan](../../../../../docs/chain-integration-plan.md#17-completion-checklist); generated scenario results describe only their own coverage.

The G0 test proves CTVS-1 ADA genesis and all four direct economic operations. It mints a disposable native asset above `2^53`, verifies exact installed-provider lookup, publishes the real reference script, observes authenticated genesis, obtains preview/construction data through the SDK, builds/approves/signs/evaluates/submits deposit, mint, withdraw and redeem, and checks accepted chain bytes plus direct CLI datum/value. After the initial deposit, each operation reads all six economic views, context and ownership together; the selected preview supplies construction data to the existing planner. Explicit caller bounds remain fixed independently of the quoted response. Non-round amounts exercise fee ceilings; receiver outputs carry a separately funded 2,000,000-lovelace top-up.

After each remaining direct operation, the harness freezes only disposable block production to compare full retained/fresh HTTP-client responses and clean journal replay at a stable point. Old explicit bases fail. Accepted mint fields, State consumption, fees, reserve, free ownership and exact State/receiver values are checked separately. The [CTVS-1 direct record](../../../../../docs/reviews/2026-10-19-ctvs1-direct/README.md) and `../fixtures/accepted/ctvs1-ada-direct.json` retain the live provenance; three offline tests replay the original Ogmios responses and bytes. No HTTP-client recovery state or production SDK change is needed.

The CTVS-2 test deploys its compiled programs and exercises deposit and redemption Request creation, snapshot settlement, funded Claim delivery, controller cancellation before expiry and permissionless expiry from a different signing key. Combined SDK reads supply the existing planners. Each Claim carries 7,900,000 lovelace: 5,000,000 storage plus 2,000,000 execution budget minus 100,000 settler fee plus a separately funded 1,000,000 top-up. Both recovery branches preserve 5,000,000 lovelace and 1,234 unexpected native tokens despite an unsupported economic body. CLI readback corroborates the protected outputs.

A separate restart/fork test recreates the daemon over its persistent volume after orderly stop and SIGKILL. It produces two actual node-to-node replacement branches, reverses delivery and settlement, cancels the restored Request and checks restart/replay parity. Both retained and newly constructed HTTP clients work without recovery state. It also stops Kupo while the original chain advances and across both real forks, requires reader-only queries to keep working, then checks automatic committed-checkpoint reconciliation before `lookupReady` returns. Kupo retains its named database volume. The generated fresh-stack configuration explicitly declares the origin/wildcard/retained coverage contract.

The recovery test now runs ADA deposit, native deposit and native redemption separately. Native redemption first seeds an accepted deposit, then proves restoration of both the funded native Claim and the SHARE Request escrow. A separate CTVS-1 native recovery case checkpoints before each direct action, reverses redeem, withdraw, mint and deposit on four actual forks, and accepts a new deposit on the replacement branch. Each reversal checks exact State accounting/custody, ownership, orphan removal, stale bases, fresh-client parity and clean replay. Direct forks also restore every consumed wallet/State input by reference. Orderly and forced daemon recreation, Kupo outages and automatic checkpoint reconciliation remain part of these cases. The [native recovery record](../../../../../docs/reviews/2026-10-19-native-recovery/README.md) and three native rollback fixtures retain the accepted events and boundaries.

Native cases bind a separately minted policy/name into Terms. Native State backing and protocol fees share that asset; its initial ADA storage reserve is 10,000,000 lovelace; the maintenance case explicitly raises it to 11,000,000 lovelace. Request/Claim carry and externally funded receiver top-ups stay in ADA. Both native assets start with 9,007,199,254,740,993 units; the underlying and unrelated inventory are checked exactly after all flows. CTVS-2 additionally cancels a valid native deposit Request and recovers an already-expired valid Request without its controller signature. Opaque refunds preserve 4,321 underlying units, 1,234 unrelated tokens and 5,000,000 lovelace. The [native acceptance record](../../../../../docs/reviews/2026-10-19-native-underlying/README.md) retains the quantities, bytes and readbacks.

The installed Kupmios encoder rejects supplemental evaluation JSON quantities above `2^53`. The node-only wallet therefore checks supplied outputs against indexed chain outputs and evaluates the CBOR through Ogmios without supplemental overrides. Missing or differing outputs fail; unconfirmed/chained contexts are unsupported. Evaluation and final signed evaluation use the node ledger, then actual submission/inclusion is required. This is a caller-side test harness boundary. The HTTP SDK, daemon and installed provider remain unchanged; generic oversized supplemental JSON is still unsupported by that provider.

Historical Kupo coverage remains a trusted deployment assertion; its HTTP API cannot prove the database's start/pruning/pattern history.

`compose.override.yml` changes only disposable pool key mounts, block production and restart behavior. The primary deployment remains `../../compose.yml`. The runner uses unique project names, loopback ports 19005/19006/19080 and existing operating quotas. These ports must be free. Generated secrets remain in private, ignored `reference/artifacts/indexer/node/g0-*` directories; upstream services and the daemon receive a public network bundle. Pool keys mount only into disposable node containers. The fork cases start two, four or six additional producers with separate databases; their copies of generated test keys remain private. No public network or existing user wallet is selected.

The command prints its artifact directory. It records network/build/runtime identities, signed candidates, actual transaction-bearing Ogmios block schemas, remote evaluations, node/SDK readbacks, committed journal snapshot and limited logs. It stops its own containers after success/failure and releases their idle Compose network so repeated runs do not exhaust Docker subnet allocation. Stopped containers, named volumes and artifacts remain for evidence/recovery. Recreate containers with the retained Compose environment and `up -d --force-recreate` when resuming a released network. Failed startup removes only its own partial Compose containers/network and preserves named volumes. They are disposable test data and may be explicitly removed with their generated Compose environment after inspection; never use a global Docker prune for this workflow.

To run the four direct operations only:

```sh
npm run test:indexer:node -- services/indexer/test/node/scenarios/direct/g0.test.ts
```

The family filters run both asset modes. Add `--testNamePattern=native` or `--testNamePattern=ada` to select one mode; a diagnostic retry of retained data must select its original family and mode. The original bootstrap and accepted history still apply.

To run just the async flow, append its file filter:

```sh
npm run test:indexer:node -- services/indexer/test/node/scenarios/async/ctvs2.test.ts
```

To run CTVS-2 mixed deposit/redemption and zero-net batches only:

```sh
npm run test:indexer:node -- services/indexer/test/node/scenarios/batches/batch.test.ts --bail=1
```

Each ADA/native case seeds existing SHARE, then settles one positive net mint, one net burn and one zero-net batch. Both gross obligations fund separate Claims against one old State even when no mint policy runs. Distinct Claim top-ups, the aggregate reward, fee liability, exact custody, escrow/Claim ownership and grouped delivery are checked separately. Both eleven-field reads share a frozen basis and retain all six views/context within the API field budget; fresh and retained clients agree with clean replay. Final forced persistent recreation keeps the HTTP SDK stateless. The [mixed-batch record](../../../../../docs/reviews/2026-10-19-mixed-batches/README.md) retains original bytes, remote purposes, CLI readback and offline regressions. The offline reversals in that record are synthetic; the separate real-fork cases below provide node-selected rollback evidence.

To run CTVS-2 mixed-batch real rollback only:

```sh
npm run test:indexer:node -- services/indexer/test/node/scenarios/batches/batch-rollback.test.ts --bail=1
```

Each ADA/native case checkpoints before all three mixed settlements and grouped deliveries, then selects six longer peer branches in reverse order. Delivery rollback restores both gross Claims; settlement rollback restores both Request escrows and the old State, removes orphan Claims and reverses fee liability even when no mint policy runs. Every reversal checks input restoration, CLI/Kupo custody and orphan absence, all six economic views, stale bases and fresh/retained stateless-client parity with clean replay. Kupo stays offline during branch selection, then must reconcile its checkpoint. Conflicting replacement settlement/delivery consumes the restored State and Requests. Each case recreates the persistent service before reversals, after restoration and after replacement. The [mixed-batch rollback record](../../../../../docs/reviews/2026-10-19-mixed-batch-rollback/README.md) retains twelve actual backward events across both modes and the corresponding accepted bytes.

To run the four G1 accepted-chain compatibility cases:

```sh
npm run test:indexer:node -- services/indexer/test/node/scenarios/ogmios/g1.test.ts --bail=1
```

Each fresh family/asset case retains exact real Ogmios RPC text through a bounded test-only relay on host port 19007, which the daemon reaches through `host.docker.internal`. The relay forwards real replies unchanged and controls only connection loss. A real included phase-two-invalid transaction consumes collateral and returns all SHARE/native tokens to a second generated key; CLI/Kupo/SDK checks prove that ordinary State effects never apply. Same-head and catch-up reconnects plus a genuine node-selected fork verify explicit offered/selected intersections, recovery generations, readiness gating and retained/fresh stateless-client replay. Two isolated invalid configurations exercise real history/network refusals. The [G1 record](../../../../../docs/reviews/2026-10-19-g1/README.md) and four `g1-ctvs*-*.json` fixtures retain the proof. Controlled malformed variants in offline tests are separate from the original accepted corpus. Port 19007 must also be free for these cases.

To run intended rejection cases for both families and asset modes:

```sh
npm run test:indexer:node -- services/indexer/test/node/scenarios/rejections/rejections.test.ts --bail=1
```

Four fresh cases require 86 real-node rejections and four separate wallet-effects failures. Valid controls are evaluated remotely and accepted normally. Negative-only construction bypasses planner checks to reach compiled guards; its local adapter assigns budgets and performs no validation. Actual Ogmios evaluation and submission must identify the expected script, witness or spent-input boundary. Exact ordinary/reference/collateral CLI UTxOs, committed history and all selected SDK fields stay unchanged. Final SIGKILL/recreation preserves all six views, ownership and applicable lifecycle data with fresh/retained stateless-client parity. The [rejection record](../../../../../docs/reviews/2026-10-19-rejections/README.md) distinguishes node failures from unsigned wallet refusals and retains original responses, CBOR, accepted controls and offline regressions. Rejected candidates are never replayed as accepted blocks.

To run the four maintenance cases only:

```sh
npm run test:indexer:node -- services/indexer/test/node/scenarios/maintenance/maintenance.test.ts
```

Each case seeds fees through an accepted economic flow, sets pause flags 1/2/3, collects fees and funds reserves from a distinct actor while both directions are paused, then clears pause flags to 0. Exact fee/State custody, no-mint bodies, required signers and witnesses, all six query views, Config identity and stateless-client replay are checked. CTVS-2 delivered Request/Claim history stays intact. Final forced daemon recreation retains the raised reserve and current reader/Kupo basis. The [maintenance record](../../../../../docs/reviews/2026-10-19-maintenance/README.md) retains four accepted fixtures and node evidence.

To run the four maintenance rollback cases only:

```sh
npm run test:indexer:node -- services/indexer/test/node/scenarios/maintenance/maintenance-rollback.test.ts --bail=1
```

Each case checkpoints before all six maintenance actions and selects six longer peer chains in reverse order. It restores fee liability, ADA reserve and pause availability, checks every restored input and orphan output through Kupo plus direct CLI State/Config/absence reads, and preserves CTVS-2 delivered lineage. Each fork holds Kupo offline until the reader selects the replacement, then requires checkpoint reconciliation. A different maintenance sequence spends the restored State; twelve persistent recreations across the four cases verify retained/fresh stateless HTTP parity and clean replay. The [maintenance rollback record](../../../../../docs/reviews/2026-10-19-maintenance-rollback/README.md) contains the original events and evidence.

To run persistent restart and actual forks only:

```sh
npm run test:indexer:node -- services/indexer/test/node/scenarios/async/restart-rollback.test.ts services/indexer/test/node/scenarios/direct/direct-restart-rollback.test.ts services/indexer/test/node/scenarios/maintenance/maintenance-rollback.test.ts services/indexer/test/node/scenarios/batches/batch-rollback.test.ts
```

Each recovery case creates a fresh network with `TxSubmissionInitDelay: 1`. The six-fork maintenance and mixed-batch cases use security parameter 200 and epoch length 2000 so the staged forks fit the node selection window; earlier recovery cases retain 100/1000 and baseline cases retain 10/1000. A diagnostic six-fork run at 100/1000 hit Cardano's `CandidateTooSparse` protection on its deepest fork; the final profile keeps consensus checks active. Transaction limits stay at 16,384 bytes, 14,000,000 memory units and 10,000,000,000 steps. Standby peers synchronize from the original node, stop at common ancestors, then forge isolated longer branches. The original node selects those branches over P2P while its socket remains open. Node databases are never reset. The test controls only generated keys/topologies and its Docker network; the HTTP SDK receives no chain cursor or workflow cache.

The daemon runs directly as PID 1 for orderly SIGTERM handling. Restart checks replace its container while preserving its named volume, hold Ogmios offline to verify readiness gating, and compare every requested public field with uninterrupted replay. Forced termination checks a committed, frozen head; interruption at every live commit boundary remains pending.

To inspect one retained stack, substitute its printed path:

```sh
docker compose --env-file /absolute/path/to/g0-XXXXXX/stack.env \
  -f services/indexer/compose.yml \
  -f /absolute/path/to/g0-XXXXXX/compose.override.yml ps -a
```

`CTVS_INDEXER_NODE_DIR` selects an already prepared G0 directory for a diagnostic retry. It is restricted to this project's generated artifact root. A preserved database retains its original bootstrap identity; a fresh command without that setting creates a new network. Select a single test file matching the retained family when retrying; switching families in an existing database fails. Diagnostic retries require the selected upstream stack running and retain ordinary chain history, so they are not equivalent to a fresh test.

The [19 October G0 record](../../../../../docs/reviews/2026-10-19-g0/README.md) contains the accepted subset, precise limits and remaining work. `../fixtures/accepted/` holds actual captured bytes and provenance for offline adapter/reader replay. Replaying a rollback locally does not establish a real node fork or independent consensus verification. Kupo reachability and exact quantities do not enable `lookupReady` without checkpoint/coverage reconciliation.

The [CTVS-2 acceptance record](../../../../../docs/reviews/2026-10-19-ctvs2-node/README.md) retains the new lifecycle evidence and source hashes. The ordinary offline suite replays the accepted bytes, including synthetic rollback of settlement and delivery; that does not establish a real node fork.

The [restart/fork record](../../../../../docs/reviews/2026-10-19-restart-rollback/README.md) and `ctvs2-real-rollback.json` retain actual backward events, replacement cancellation and restart evidence. Fork containers carry the label `ctvs.disposable.project=<printed-project>` and stop with the test; they remain inspectable alongside the Compose containers.

Repeated retained runs can exhaust Docker's default subnet pools. Release only empty default networks whose Compose project label matches this project's generated `g0-*` artifact directory. Inspect the label and endpoint list first. Volumes and evidence remain separate; containers may need `--force-recreate` when restoring a stack whose old network ID was removed. Use no global prune for this workflow.
