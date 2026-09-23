# CTVS-1 synchronous reference

Direct deposit, mint, withdraw and redeem, plus genesis, fee collection, reserve top-up and pause controls.

Terms must advertise immutable modes **1, 2 or 3**. Unsupported family modes and actions reject. F permanently locks Config. P owns vault spending and share minting. This family has no Q claim script.

- [`client/`](client/README.md) owns the typed public planner API and its unit/property tests.
- [`onchain/`](onchain/) owns the independently compiled family entrypoints, family-specific predicates, pinned manifests and handler tests.
- [`../../packages/onchain/`](../../packages/onchain/README.md) supplies canonical shared predicates without duplicated editable source.
- [`../../testing/integration/ctvs1/`](../../testing/integration/ctvs1/) owns signed ADA/native lifecycle and compiled rejection tests.

From `reference/`:

```sh
npm run build:ctvs1
npm run test:onchain -- ctvs1
npx vitest run --project unit --project property implementations/ctvs1/client
npx vitest run --project integration testing/integration/ctvs1
```

Build artifacts and source manifests are generated under `artifacts/ctvs1/`. Integration requires the matching build. Use the full `npm run check` gate before recording new validation evidence. See [the validation record](../../VALIDATION.md) for measured scope and remaining acceptance gates.
