# ADR 0006: Loss, insolvency, and recovery states

- Status: Proposed
- Date: 2026-08-27
- Scope: Impairment, bad debt, haircuts, and recovery

## Context

Real strategies can lose value, become illiquid, suffer bad debt, or depend on
stale valuations. The current state model has no impaired or insolvent status,
loss-allocation rule, reserve waterfall, partial redemption, or recovery path.
Silently lowering `total_assets` does not explain who recognized the loss or
which actions remain safe.

## Decision

Every yield-bearing accounting profile must define authenticated transitions
among at least these semantic states:

```text
Healthy -> Impaired -> Insolvent -> Recovery -> Healthy or Closing
```

The profile must specify:

- the event and authorization that recognizes a loss;
- the order in which collateral, insurance, protocol reserves, and shareholder
  value absorb losses;
- partial-fill and haircut calculations;
- stale-NAV and stale-oracle behavior;
- allowed actions in every state;
- recovery contributions and recapitalization ownership;
- terminal treatment when solvency cannot be restored.

Loss recognition must update share NAV and liabilities in the same authenticated
transition or through a committed sequence that cannot be partially applied.

## Consequences

- Integrators can distinguish illiquidity from insolvency.
- Shareholders receive explicit, deterministic loss treatment.
- Each managed profile needs a profile-specific recovery waterfall.

## Related public implementations

- [Indigo CDP on-chain logic](https://github.com/IndigoProtocol/indigo-smart-contracts/blob/main/src/Indigo/Contracts/CDP/OnChain.hs)
  and [Stability Pool logic](https://github.com/IndigoProtocol/indigo-smart-contracts/blob/main/src/Indigo/Contracts/StabilityPool/OnChain.hs):
  implement collateralized debt, liquidation eligibility, and stability-pool
  loss absorption.
- [Lenfi collateral validator](https://github.com/lenfiLabs/lenfi-smart-contracts/blob/main/validators/collateral.ak),
  [leftovers validator](https://github.com/lenfiLabs/lenfi-smart-contracts/blob/main/validators/leftovers.ak),
  and [oracle validator](https://github.com/lenfiLabs/lenfi-smart-contracts/blob/main/validators/oracle_validator.ak):
  cover liquidation, collateral remainder claims, and time-bounded valuation.
- [FluidTokens Lending V4 contracts](https://github.com/FluidTokens/ft-cardano-loans-v4):
  contain several liquidation modes, Dutch auctions, oracle feeds, late-payment
  penalties, refinancing, and automated liquidation incentives.
- [Liqwid liquidation bot](https://github.com/Liqwid-Labs/liqwid-liquidation-bot):
  demonstrates public execution handling for unhealthy positions, liquidation
  rewards, profitability checks, and expected contention failures. This is
  off-chain execution code, not Liqwid's private V2/V3 validator source.

## Alternatives considered

- Use `Paused` for every failure: rejected because pausing does not allocate
  losses or explain which restorative actions remain available.
- Let governance choose a recovery after the incident: rejected because users
  cannot price an undisclosed loss waterfall.

## Acceptance gates

- Property tests prove conservation through loss and recovery transitions.
- Redemptions cannot extract more than the holder's post-loss entitlement.
- Repayment, collateral addition, and recovery funding remain possible whenever
  their profile declares them safe.
- Terminal insolvency has a deterministic settlement rule.
