# ADR 0007: Action-scoped emergency controls

- Status: Proposed
- Date: 2026-08-27
- Scope: Pause state, authority, and emergency access

## Context

The schema defines several pause statuses but the `Pause` action does not
identify a target status. Coarse global pauses can block users from repaying or
adding collateral, while immutable keys create permanent lock or compromise
risk. Different incidents require different action restrictions.

## Decision

Replace the generic pause transition with a typed action-policy update that
sets an explicit, bounded action bitmap or equivalent versioned policy.

The baseline policy must independently control deposits, mints, withdrawals,
redemptions, new borrowing, collateral removal, liquidation, settlement, and
maintenance. Repayment, collateral addition, claims already fully funded, and
approved recovery actions should remain available unless the profile proves
they are unsafe.

Emergency authority must support:

- script or multisignature ownership;
- authenticated rotation;
- optional timelock for policy expansion;
- immediate restriction of dangerous actions;
- expiry or review deadlines;
- a separately authorized emergency-exit or migration path.

Authority changes cannot modify economic balances or redirect user assets.

## Consequences

- Emergency responses can preserve healing actions while restricting risk.
- Authority validation and client status reporting become more complex.
- Deployments must disclose governance and rotation policies.

## Related public implementations

- [SundaeSwap settings validator](https://github.com/SundaeSwap-finance/sundae-contracts/blob/main/validators/settings.ak)
  and [pool validator](https://github.com/SundaeSwap-finance/sundae-contracts/blob/main/validators/pool.ak):
  separate global operational settings from authenticated pool transitions.
- [Lenfi pool-config validator](https://github.com/lenfiLabs/lenfi-smart-contracts/blob/main/validators/pool_config.ak):
  distinguishes adjustable governed parameters from immutable risk parameters.
- [Indigo governance contracts](https://github.com/IndigoProtocol/indigo-smart-contracts/tree/main/src/Indigo/Contracts/Governance)
  and [version registry](https://github.com/IndigoProtocol/indigo-smart-contracts/tree/main/src/Indigo/Contracts/Governance/VersionRegistry):
  provide public governance, execution, polling, and version-control precedents.
- [FluidTokens Lending V4 contracts](https://github.com/FluidTokens/ft-cardano-loans-v4):
  include an upgradable global configuration, permissioned pools, multiple
  authorization methods, and lender-controlled emergency position sales.

## Alternatives considered

- Keep four coarse statuses: rejected because lending, oracle, and settlement
  incidents require different action matrices.
- Use one permanent key: rejected because loss or compromise of that key can
  permanently disable or endanger the vault.

## Acceptance gates

- Every action has a tested policy outcome for every emergency state.
- Authority rotation cannot redirect fees, reserves, receivers, or share-backed
  assets.
- A lost emergency key has a disclosed recovery or expiry path.
- Emergency exit cannot bypass the accepted loss waterfall.
