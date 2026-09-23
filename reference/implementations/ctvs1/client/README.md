# @ctvs/ctvs1

Strict TypeScript transaction planners for the synchronous CTVS-1 reference implementation. Terms must advertise modes `1`, `2` or `3`. A `SyncDeployment` names F and P and requires `claimScript: null`.

## API

| Function | Result |
| --- | --- |
| `buildGenesisPlan` | Consumes the selected seed and creates separate immutable Config and zero-supply State outputs, minting exactly ID and STATE. |
| `buildDirectPlan` | Quotes and plans `deposit`, `mint`, `withdraw` or `redeem`, with the user's explicit bound, State successor, exact receiver payment and coupled share mint/burn. |
| `buildCollectFeesPlan` | Pays all accrued fees to the immutable Terms destination and clears that liability. |
| `buildTopUpReservePlan` | Adds a positive amount to the State ADA reserve. |
| `buildSetPausePlan` | Sets pause flags and requires the configured pause key signer. |

Direct calls use a resolved State input and reference the immutable Config. They validate State custody, Terms commitment, the chosen mode, pause status, quantity bounds and aggregate value bounds. Receiver ADA topups are explicit external funding and are excluded from the economic quote.

```ts
import { buildDirectPlan } from "@ctvs/ctvs1";
import { planToJson, type FamilyStateContext } from "@ctvs/planning";
import type { Destination } from "@ctvs/protocol";

function depositIntent(context: FamilyStateContext<"ctvs1">, receiver: Destination) {
  return planToJson(buildDirectPlan({
    ...context,
    operation: "deposit",
    amount: 101_000n,
    bound: 99_900n,
    receiver,
    receiverTopup: 2_000_000n,
  }));
}
```

The bound is minimum shares for deposit, maximum gross assets for mint, maximum shares for withdraw, and minimum net assets for redeem. The example quantities are illustrative and do not establish an acceptable market quote for another State.

## Construction boundary

The result is a reviewable transaction intent. It explicitly reports that ledger construction, funding selection, network verification, fee/collateral balancing, evaluation and signing remain unresolved. Consumers must authenticate deployment and UTxO evidence and construct/evaluate the complete transaction before signing. The repository's `testing/` package exercises that next layer locally against compiled validators.

## Validation

From `reference/`:

```sh
npx vitest run --project unit --project property implementations/ctvs1/client
```

The suite covers all four direct operations, genesis, every maintenance operation, disabled modes, pause and authority checks, amount boundaries, native/ADA accounting, and generated supply and value conservation across 300 inputs. The SDK exports no asynchronous request, settlement or delivery planner.
