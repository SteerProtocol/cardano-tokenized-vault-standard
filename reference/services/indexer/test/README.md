# Indexer tests

`unit/` holds fast synthetic, failure-injection and recorded-chain replay tests. `fixtures/accepted/` holds the original captured bytes shared by offline replay and live acceptance verification. File moves preserve those bytes; dated review manifests retain the paths used by their original runs.

```text
test/
  fixtures/accepted/          Captured public chain and response evidence
  support/
    cleanup.ts               Attempt every shutdown and retain failures
    evaluation.ts            Confirm supplied inputs before remote evaluation
    evidence/                Passive CBOR and captured-RPC inspection
  unit/                      Offline checks, including mocked harness failures
  node/
    support/                 Stack, capture, wallet, execution and restart helpers
    scenarios/
      direct/                CTVS-1 economic flows and recovery
      async/                 CTVS-2 Requests, Claims and recovery
      maintenance/           Fee, reserve and pause flows
      batches/               Mixed and zero-net settlements and recovery
      rejections/            Intended ledger and wallet refusals
      ogmios/                Real responses, reconnects and included failures
      shared/                Reusable accepted scenario setup
    fixtures/                Disposable network bootstrap inputs
    compose.override.yml     Test-only deployment differences
```

Offline evidence utilities depend on captured values and library code. They do not import the live stack or scenario modules. Unit tests that exercise the live harness itself mock its stack and transport dependencies explicitly.

Every node entrypoint uses `withNode` to register stack shutdown before environment validation. It owns captures and fork copies and accepts additional cleanup for resources such as the relay. Cleanup attempts every action in reverse acquisition order and retains scenario and shutdown failures together. Capture startup also closes its socket if intersection negotiation fails. Local helpers can close captures early to freeze evidence; final fixture cleanup remains safe after an early close. After shutdown it releases the owned idle network while retaining stopped containers, named volumes and evidence; failed startup uses Compose down without deleting volumes.

Keep scenario assertions, caller bounds, independent CLI checks, transaction order and accepted fixture bytes intact during refactors. The HTTP client carries endpoint configuration and vault identity only; all journal, replay and recovery state belongs to the service or the test harness.

Run `npm run test:indexer` from `reference/` for offline tests. The [node guide](node/README.md) documents the explicit Docker acceptance command and scenario filters. The [integration plan](../../../../docs/chain-integration-plan.md#17-completion-checklist) owns current project status. Scenario result files report their local coverage rather than a copy of the project backlog.
