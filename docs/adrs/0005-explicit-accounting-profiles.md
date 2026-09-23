# ADR 0005: Explicit accounting profiles

- Status: Proposed
- Date: 2026-08-27
- Scope: Direct custody, lending, managed NAV, and stake-aware ADA

## Context

The current closed-value equation is valid only when share-backed assets are
physically held in the state UTxO. It cannot account for loans, strategy
positions, staking rewards, receivables, or externally reported NAV. Calling
all of those systems conforming while leaving their accounting private would
create a common share interface without common economic meaning.

## Decision

Keep `direct_custody` as an explicitly non-yielding base profile and require a
declared, versioned accounting profile for any other vault.

Every profile must normatively define:

- the `total_assets` equation;
- immediately available liquidity;
- liabilities and reserves;
- allowed NAV-changing transitions;
- update authorization and freshness;
- gain and loss recognition;
- profile-specific limits;
- `maxDeposit`, `maxMint`, `maxWithdraw`, and `maxRedeem` semantics;
- closure and migration preconditions.

Initial additional profiles should be specified independently:

1. `lending_pool`: cash, borrows, interest index, reserves, and bad debt.
2. `managed_nav`: authenticated position set and valuation reports.
3. `stake_aware_ada`: delegation, rewards, withdrawals, and reward attribution.

No vault may identify as `direct_custody` when its NAV depends on an external
position, oracle, report, or discretionary accounting update.

## Consequences

- CTVS conformance communicates economic semantics, not only token mechanics.
- Each profile needs separate validators, vectors, and security analysis.
- Broad vault coverage is delayed until profile-specific risks are resolved.

## Related public implementations

- [Lenfi pool validator](https://github.com/lenfiLabs/lenfi-smart-contracts/blob/main/validators/pool.ak),
  [liquidity-token policy](https://github.com/lenfiLabs/lenfi-smart-contracts/blob/main/validators/liquidity_token.ak),
  [oracle validator](https://github.com/lenfiLabs/lenfi-smart-contracts/blob/main/validators/oracle_validator.ak),
  and [pool staking validator](https://github.com/lenfiLabs/lenfi-smart-contracts/blob/main/validators/pool_stake.ak):
  separate cash, lent-out value, LP supply, oracle state, and staking rewards.
- [Indigo CDP on-chain logic](https://github.com/IndigoProtocol/indigo-smart-contracts/blob/main/src/Indigo/Contracts/CDP/OnChain.hs),
  [Stability Pool logic](https://github.com/IndigoProtocol/indigo-smart-contracts/blob/main/src/Indigo/Contracts/StabilityPool/OnChain.hs),
  and [Oracle contracts](https://github.com/IndigoProtocol/indigo-smart-contracts/tree/main/src/Indigo/Contracts/Oracle):
  show that CDP debt, liquidation liquidity, and oracle valuation require
  separate authenticated accounting components.
- [FluidTokens Lending V4 contracts](https://github.com/FluidTokens/ft-cardano-loans-v4):
  expose distinct static and dynamic pools, requests, loans, repayments, oracle
  feeds, bonds, installment formulas, and staking-aware ADA liquidity.
- [SundaeSwap pool staking validator](https://github.com/SundaeSwap-finance/sundae-contracts/blob/main/validators/pool_stake.ak):
  handles stake rewards separately from ordinary pool transition logic.

## Alternatives considered

- Standardize only deposits and redemptions: rejected because identical share
  interfaces can conceal materially different liquidity and loss behavior.
- Add every profile to one universal state datum: rejected because it would
  create a large, ambiguous, and difficult-to-audit state machine.

## Acceptance gates

- Profile identity is authenticated and discoverable by clients.
- Each accepted profile publishes executable accounting vectors.
- Quote and limit semantics distinguish NAV from available liquidity.
- A vault cannot change profiles without the migration protocol.
