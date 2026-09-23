# @ctvs/ctvs2

Strict TypeScript transaction planners for the asynchronous CTVS-2 reference implementation. Terms must advertise modes `4`, `8` or `12`. An `AsyncDeployment` names F, P and Q.

## API

| Function | Result |
| --- | --- |
| `buildGenesisPlan` | Creates immutable Config and zero-supply State from the deployment seed. |
| `buildRequestPlan` | Creates a candidate exact-gross deposit or exact-shares redeem request, with complete escrow value and separate recovery/economic envelopes. |
| `buildBatchPlan` | Settles sorted requests against one authenticated-by-consumer State snapshot, creates one Claim per request, updates State and couples the net share mint/burn. |
| `buildRefundPlan` | Cancels with the explicit controller signer, or refunds after expiry without that signer. |
| `buildDeliverPlan` | Delivers a sorted set of Q Claims with an identical exhaustive redeemer list and separate destinations. |
| `buildCollectFeesPlan`, `buildTopUpReservePlan`, `buildSetPausePlan` | Apply the same immutable accounting and maintenance rules as CTVS-1. |

Batch planning preserves the common snapshot across deposits and redemptions. It bounds every gross/net aggregate, issued and burned shares, fees and rewards independently before validating the successor. Claims carry the request's ADA reserve and unused execution budget plus any explicit external topup. Zero net share change omits mint; zero total settler fee omits the reward output. Permissioned settlers must appear in Terms and every batch requires the named settler signer.

```ts
import { buildBatchPlan } from "@ctvs/ctvs2";
import type { FamilyStateContext, ProtectedInput } from "@ctvs/planning";

function settlementIntent(
  context: FamilyStateContext<"ctvs2">,
  requests: ProtectedInput[],
  rewardKey: string,
  lowerPosixMs: bigint,
  upperPosixMs: bigint,
) {
  return buildBatchPlan({
    ...context,
    requests: requests.map(input => ({ input, claimTopup: 0n })),
    rewardKey,
    validity: { lowerPosixMs, upperPosixMs },
  });
}
```

The interval must be finite and nonempty, with an inclusive lower bound and exclusive upper bound. Batch upper bounds cannot exceed any selected request deadline. Expiry refunds require the lower bound at or after the deadline. Controller cancellation remains available after expiry.

## Independent recovery and provenance

Refunds decode only the supported recovery envelope. Unsupported economic bodies remain recoverable. Refund and delivery plans preserve the full actual source value, including surplus assets, and use no State or Config input/reference. Protected ID and STATE tokens cannot select request recovery. Creation of a candidate Request does not prove the named controller created it; a funded candidate Claim does not prove authentic settlement. The consumer must establish provenance separately when that distinction matters.

## Construction boundary and validation

Every result is a transaction intent with construction, network authentication, funding, fees, collateral, evaluation and signing explicitly unresolved. `buildRequestPlan` cannot predict its eventual output reference before a transaction exists. The repository's `testing/` package separately constructs and evaluates complete local transactions against the compiled scripts.

From `reference/`:

```sh
npx vitest run --project unit --project property implementations/ctvs2/client
```

Tests cover family modes, request directions, settlement snapshot rounding, cap offsets, aggregate overflows, gross pre-existing supply, deadlines, controller cancellation, surplus preservation and all maintenance. Generated cases test 150 batch permutations and 100 multi-Claim deliveries. The SDK exports no direct deposit/mint/withdraw/redeem planner.

For a chain UTxO with unsupported or deeply nested economic data, use `buildRefundPlanFromCbor` with protected source metadata and `datumCbor`. It projects only the supported recovery envelope through the maintained CBOR library, preserving full refund value without requiring settlement eligibility. `buildRefundPlan` remains available for already decoded data.
