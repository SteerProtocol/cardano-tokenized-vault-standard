# ADR 0010: Versioned migration protocol

- Status: Proposed
- Date: 2026-08-27
- Scope: Upgrades, successor discovery, user consent, and terminal retirement

## Context

Deploying a new vault is not sufficient migration semantics. Users and
integrators need to identify the canonical successor, transform shares, move
assets and liabilities, preserve or settle pending requests, and reject an
unwanted migration. Lending and managed profiles may have outstanding debt,
accrued yield, losses, or external positions that cannot be exited atomically.

## Decision

Define an authenticated version registry and profile-specific migration
protocol before publishing a production CTVS version.

Every migration must specify:

- source and destination vault identities and versions;
- the exact state and datum transformation;
- asset, liability, fee, reserve, and share-supply conservation;
- treatment of requests, claims, and delegated capabilities;
- old-share burn and new-share mint rules;
- user consent or an equivalent opt-out path;
- a bounded migration window and terminal treatment of the old vault;
- canonical-successor discovery for wallets and indexers.

Simple profiles may migrate atomically. Profiles with outstanding positions
must publish a phased migration plan that freezes unsafe new actions, snapshots
indexes or NAV, preserves restorative actions, and proves each intermediate
state remains solvent.

Migration authority must be distinct from ordinary pause authority and subject
to the disclosed governance and timelock policy. An emergency exit must remain
available when migration cannot complete safely.

## Consequences

- Security fixes and version changes have a defined ecosystem path.
- Migration becomes a major profile-specific state machine requiring its own
  review.
- Integrators can distinguish canonical successors from unrelated deployments.

## Related public implementations

- [Indigo version-registry contracts](https://github.com/IndigoProtocol/indigo-smart-contracts/tree/main/src/Indigo/Contracts/Governance/VersionRegistry)
  and [governance execution contracts](https://github.com/IndigoProtocol/indigo-smart-contracts/tree/main/src/Indigo/Contracts/Governance/Execute):
  provide public authenticated version and governed-transition precedents.
- [Lenfi pool-config validator](https://github.com/lenfiLabs/lenfi-smart-contracts/blob/main/validators/pool_config.ak)
  and [pool validator](https://github.com/lenfiLabs/lenfi-smart-contracts/blob/main/validators/pool.ak):
  distinguish governed configuration, immutable pool identity, and terminal pool
  destruction conditions.
- [SundaeSwap settings validator](https://github.com/SundaeSwap-finance/sundae-contracts/blob/main/validators/settings.ak)
  and [extensible pool validator](https://github.com/SundaeSwap-finance/sundae-contracts/blob/main/validators/pool.ak):
  show an authenticated settings layer and pool logic designed to avoid binding
  execution to one fixed order contract.
- [FluidTokens Lending V4 contracts](https://github.com/FluidTokens/ft-cardano-loans-v4):
  document an upgradable global config plus transferable lender and borrower
  positions, refinancing, manager tokens, and emergency position sales that a
  migration protocol must preserve or settle.

## Alternatives considered

- Require users to exit and re-enter manually: rejected because old validators
  may be defective, positions may be illiquid, and integrations can become
  stranded.
- Permit unrestricted in-place upgrades: rejected because it weakens the
  immutability and disclosure guarantees of a vault deployment.

## Acceptance gates

- Tests prove conservation across every supported migration path.
- Users can decline migration without losing the existing exit rights promised
  by the source profile.
- Pending requests cannot be duplicated, silently discarded, or replayed.
- The old vault reaches a defined closed or legacy state.
