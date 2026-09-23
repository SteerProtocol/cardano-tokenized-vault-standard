# ADR 0004: Complete asynchronous request lifecycle

- Status: Proposed
- Date: 2026-08-27
- Scope: Request, settlement, cancellation, claim, and fee wire semantics

## Context

The asynchronous extension leaves pricing, cancellation races, ordering,
rewards, liveness, and claim topology unresolved. The current request datum does
not carry the pricing commitment described in the prose, and generic `Data`
redeemers cannot establish interoperable transaction construction.

## Decision

Define a complete typed lifecycle before publishing the asynchronous wire
format:

```text
Pending -> Selected -> Settled -> Claimed
       \-> Cancelled
       \-> Expired and reclaimed
```

The request datum must commit to:

- request kind and exact input quantity;
- owner authorization policy;
- success and refund destinations;
- pricing rule or eligible snapshot range;
- minimum output or maximum input;
- partial-fill policy;
- expiry and cancellation rules;
- maximum settler fee and cancellation tip;
- storage and execution budgets.

Typed redeemers must cover owner cancellation, expired permissionless
cancellation, selection, settlement, claim, and reclaim. Finite validity
intervals and state rules must make settlement and cancellation mutually
exclusive. Actual execution cost must be allocated deterministically and unused
budget returned.

## Consequences

- Independent builders can construct compatible lifecycle transactions.
- The schema becomes larger and requires versioned evolution.
- Pricing and liveness are protocol decisions rather than settler conventions.

## Related public implementations

- [Minswap v2 order validator](https://github.com/minswap/minswap-dex-v2/blob/main/validators/order_validator.ak):
  exposes typed apply, owner-cancel, and permissionless expired-cancel paths with
  distinct authorization checks.
- [Minswap v2 pool validator](https://github.com/minswap/minswap-dex-v2/blob/main/validators/pool_validator.ak):
  validates success receivers, receiver datums, maximum batcher fees, expiry,
  routing indexes, and minimum receive amounts.
- [SundaeSwap order datum types](https://github.com/SundaeSwap-finance/sundae-contracts/blob/main/lib/types/order.ak)
  and [order validator](https://github.com/SundaeSwap-finance/sundae-contracts/blob/main/validators/order.ak):
  separate user intent, ownership, destination, execution, and cancellation.
- [Lenfi order contract](https://github.com/lenfiLabs/lenfi-smart-contracts/blob/main/validators/order_contract.ak):
  implements independently created user orders that anyone can execute.
- [FluidTokens Lending V4 contracts](https://github.com/FluidTokens/ft-cardano-loans-v4):
  include separate request, loan, repayment, auction, and manager scripts for a
  multi-stage lending lifecycle.

## Alternatives considered

- Leave lifecycle semantics to each implementation: rejected because requests
  would not be interoperable or safely indexable.
- Require every settlement to pay the receiver directly: rejected because
  variable outputs and script destinations often require a separate claim.

## Acceptance gates

- Golden wire fixtures exist for every datum and redeemer constructor.
- Tests prove a request cannot settle twice or both settle and cancel.
- One output cannot satisfy multiple requests.
- Permissionless reclaim works after expiry when the primary settler is absent.
