# CTVS-2 asynchronous reference

Request creation, snapshot batch settlement, controller cancellation, permissionless expiry and fixed funded-Claim delivery, plus genesis and shared maintenance.

Terms must advertise immutable modes **4, 8 or 12**. Unsupported family modes and actions reject. F permanently locks Config. P owns State and Request spending and share minting. Q independently enforces complete Claim delivery.

- [`client/`](client/README.md) owns the typed public planner API and its unit/property tests.
- [`onchain/`](onchain/) owns the independently compiled family entrypoints, family-specific predicates, pinned manifests and handler tests.
- [`../../packages/onchain/`](../../packages/onchain/README.md) supplies canonical shared predicates without duplicated editable source.
- [`../../testing/integration/ctvs2/`](../../testing/integration/ctvs2/) owns signed ADA/native lifecycle and compiled rejection tests.

From `reference/`:

```sh
npm run build:ctvs2
npm run test:onchain -- ctvs2
npx vitest run --project unit --project property implementations/ctvs2/client
npx vitest run --project integration testing/integration/ctvs2
```

Build artifacts and source manifests are generated under `artifacts/ctvs2/`. Integration requires the matching build. Use the full `npm run check` gate before recording new validation evidence. See [the validation record](../../VALIDATION.md) for measured scope and remaining acceptance gates.
