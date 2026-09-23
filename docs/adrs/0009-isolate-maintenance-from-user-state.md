# ADR 0009: Isolate maintenance from user state

- Status: Proposed
- Date: 2026-08-27
- Scope: Fee collection, reserve top-ups, and operational state churn

## Context

Permissionless fee claims and reserve top-ups currently consume the same state
UTxO as user actions. Low-value maintenance can invalidate deposits,
withdrawals, settlements, repayments, or liquidations. Some maintenance also
requires a third party to contribute minimum ADA without receiving a reward.

## Decision

Remove routine maintenance from the hot user state wherever the accounting
profile permits it.

- Accrued fees should use an authenticated fee escrow or be collected as part
  of an already-required user or batch transition.
- Reserve top-ups should use a dedicated reserve mechanism or be combined with
  an existing state transition.
- Zero-value and uneconomic maintenance transitions must be rejected.
- Standalone maintenance must have a threshold, cooldown, or bounded executor
  reward when it imposes shared protocol cost.
- Solvency-critical actions such as repayment and liquidation must not depend
  on treasury maintenance winning the same state race.

Moving fees to escrow must preserve exact reconciliation between charged fees,
escrow value, paid fees, and outstanding liabilities.

## Consequences

- User and solvency-critical transactions experience less avoidable churn.
- Additional authenticated UTxOs may increase discovery and transaction costs.
- Fee accounting requires cross-component conservation proofs.

## Related public implementations

- [SundaeSwap pool validator](https://github.com/SundaeSwap-finance/sundae-contracts/blob/main/validators/pool.ak)
  and [pool staking validator](https://github.com/SundaeSwap-finance/sundae-contracts/blob/main/validators/pool_stake.ak):
  separate pool execution from reward withdrawal while accounting for protocol
  fees and treasury routing.
- [Lenfi delayed repayment merge](https://github.com/lenfiLabs/lenfi-smart-contracts/blob/main/validators/delayed_repayment_merge.ak)
  and [leftovers validator](https://github.com/lenfiLabs/lenfi-smart-contracts/blob/main/validators/leftovers.ak):
  use intermediate UTxOs for busy-pool repayments and post-liquidation value.
- [Indigo Collector contracts](https://github.com/IndigoProtocol/indigo-smart-contracts/tree/main/src/Indigo/Contracts/Collector)
  and [Treasury contracts](https://github.com/IndigoProtocol/indigo-smart-contracts/tree/main/src/Indigo/Contracts/Treasury):
  isolate collection and treasury responsibilities from CDP and Stability Pool
  validators.
- [FluidTokens Lending V4 contracts](https://github.com/FluidTokens/ft-cardano-loans-v4):
  use separate lender-manager and pool-manager UTxOs for liquidation proceeds,
  compounding, owner withdrawals, and bot incentives.

## Alternatives considered

- Keep maintenance on the singleton with minimum amounts: rejected as the sole
  fix because even economically meaningful maintenance can invalidate urgent
  actions.
- Make maintenance privileged: rejected because privilege alone does not remove
  contention or guarantee liveness.

## Acceptance gates

- Fee and reserve accounting reconcile under property tests.
- No zero-delta maintenance transition validates.
- Fee collection cannot invalidate an already-created request.
- Repayment and liquidation liveness does not depend on maintenance state.
