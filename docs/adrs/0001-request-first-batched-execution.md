# ADR 0001: Request-first batched execution

- Status: Proposed
- Date: 2026-08-27
- Scope: CTVS-1 execution topology

## Context

Every direct action currently consumes the singleton state UTxO. Concurrent
transactions are therefore built against the same state head, only one can
succeed, and all others must be rebuilt and re-signed. Fee claims, reserve
top-ups, and authority changes contend with user actions as well.

Production Cardano protocols commonly use independent intent UTxOs and bounded
batch settlement to preserve user intent without requiring every user to win a
race for shared state.

## Decision

Make independent request UTxOs and bounded batch settlement the primary CTVS-1
execution interface. Retain direct synchronous actions only as an optional fast
path with identical quote and authorization semantics.

A batch transition must:

1. Consume one authenticated state UTxO and a bounded set of request UTxOs.
2. Commit to the consumed state reference and declared pricing rule.
3. Map every request to a unique receiver, claim, or refund output by explicit
   indexes in a typed batch redeemer.
4. Prove mapping completeness and prevent one output from satisfying multiple
   requests.
5. Apply deterministic fee allocation and return unused execution budgets.
6. Publish maximum batch size and execution-budget limits for the version.

Request construction must not require the user to consume the live state UTxO.

## Consequences

- Normal user intents survive unrelated state transitions until they expire,
  settle, or are cancelled.
- Settlement becomes materially more complex and requires index, uniqueness,
  and completeness proofs.
- Wallets need request discovery, status, cancellation, and claim support.
- The synchronous profile can no longer be treated as the only CTVS-1 path.

## Related public implementations

- [SundaeSwap order validator](https://github.com/SundaeSwap-finance/sundae-contracts/blob/main/validators/order.ak)
  and [pool validator](https://github.com/SundaeSwap-finance/sundae-contracts/blob/main/validators/pool.ak):
  independent order UTxOs are applied through batched pool execution.
- [Minswap v2 order validator](https://github.com/minswap/minswap-dex-v2/blob/main/validators/order_validator.ak)
  and [pool batching validator](https://github.com/minswap/minswap-dex-v2/blob/main/validators/pool_validator.ak):
  typed order application, cancellation, input indexing, and batched pool
  transitions.
- [Lenfi order contract](https://github.com/lenfiLabs/lenfi-smart-contracts/blob/main/validators/order_contract.ak)
  and [delayed repayment merge](https://github.com/lenfiLabs/lenfi-smart-contracts/blob/main/validators/delayed_repayment_merge.ak):
  user orders and delayed repayment handling when shared pool state is busy.
- [Indigo Stability Pool on-chain logic](https://github.com/IndigoProtocol/indigo-smart-contracts/blob/main/src/Indigo/Contracts/StabilityPool/OnChain.hs):
  a public request and liquidity-state transition precedent.

## Alternatives considered

- Keep one action per state transition: rejected because it serializes all user
  and maintenance traffic.
- Shard vault accounting across multiple state UTxOs: deferred because it
  introduces share-price synchronization and cross-shard accounting problems.

## Acceptance gates

- A real transaction builder settles mixed deposit and redemption requests.
- Request-to-output validation is linear or near-linear in batch size.
- Benchmarks cover worst-case datum sizes, transaction size, memory, CPU, and
  fees.
- A stale direct transaction cannot invalidate an already-created request.
