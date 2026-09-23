# @ctvs/planning

Shared strict TypeScript transaction intent types, value accounting, deployment checks and maintenance primitives for the two CTVS SDKs. Application code normally calls `@ctvs/ctvs1` or `@ctvs/ctvs2`.

## Boundaries

`TransactionPlan` identifies exact protected input references, reference inputs, indexed outputs, role redeemers, mint quantities, required signers and finite validity bounds when required. All quantities use `bigint`. The value representation uses `ada` and lowercase `policyHex.assetNameHex` keys, rejects negative or overflowing quantities, and keeps every nonzero source asset during recovery and delivery.

Plans explicitly carry `kind: "transaction_intent"`, `ledgerConstruction.status: "not_constructed"`, `signed: false` and `submitReady: false`. Funding selection, change, fees, collateral, slot conversion, script witnesses, ledger evaluation and signing belong to the consuming ledger adapter. `validatePlan` checks structure and internal consistency. It cannot authenticate a UTxO, implementation, chain point, or supplied deployment identity.

## Types and helpers

- `SyncDeployment` requires `family: "ctvs1"` and `claimScript: null`. `AsyncDeployment` requires `family: "ctvs2"` and the Q script hash.
- `ProtectedInput` contains the supplied reference, complete address, inline Plutus Data datum, actual complete value, and explicit `referenceScript: null`.
- `assertContext` binds Terms to the supplied deployment commitment, network domain and compatible family modes. `resolveState` also validates the State datum and its complete custody equation.
- `stateValue`, `requestValue` and `claimValue` construct protocol value equations. `actualValue` and `assertSameValue` validate resolved evidence.
- `finiteValidity` requires ordered, nonnegative, finite POSIX millisecond `bigint` endpoints. Lower is inclusive and upper is exclusive. The ledger adapter must preserve these semantics when choosing slots.
- `planToJson` produces portable review data, converting quantities to decimal strings and including semantic Data and CBOR for constructor/map values. It does not serialize a Cardano transaction.

Genesis and maintenance primitives require an explicit family argument. Each implementation SDK supplies that argument and narrows the deployment type. Shared modules import the maintained Data serialization and math API from `@ctvs/protocol`.

## Validation

From `reference/`, run:

```sh
npx vitest run --project unit --project property packages/planning
```

Tests cover deployment and custody mismatches, invalid intent shapes, exact value equations and generated asset aggregation boundaries. SDK tests additionally exercise these helpers through every supported operation. The separate `testing/` package owns actual local transaction construction and compiled script evaluation.
