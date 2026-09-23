# ADR 0003: Terminal redemption and closure

- Status: Proposed
- Date: 2026-08-27
- Scope: Final share burn, residual value, and vault termination

## Context

Virtual balances and floor rounding can leave share-backed assets after the
entire share supply is burned. The current action schema has no terminal
redemption, residual beneficiary, closure, or storage-reserve recovery path.
Closing only after every accounting field is already zero does not explain how
the system reaches that state.

## Decision

Define separate `TerminalRedeem` and `CloseVault` transitions.

`TerminalRedeem` must:

1. Burn the complete outstanding share supply.
2. Pay all remaining share-backed assets to the final shareholder, subject to
   any accepted loss waterfall.
3. Keep accrued fees and declared storage reserves separate from share-backed
   value.
4. Reject execution while pending requests or profile-specific liabilities
   remain.
5. Move the state into a `Closing` status rather than recreating an ordinary
   open state with zero shares.

`CloseVault` must require zero shares, zero share-backed assets, zero accrued
fees, zero pending requests, and zero profile-specific liabilities. It burns or
retires the authenticated state and config tokens and pays declared storage
reserves to the immutable reserve-return destination.

## Consequences

- Residual rounding value has an explicit owner.
- Closure becomes profile-aware and cannot ignore debt or pending claims.
- The factory policy must define terminal token retirement.

## Related public implementations

- [Lenfi pool validator](https://github.com/lenfiLabs/lenfi-smart-contracts/blob/main/validators/pool.ak)
  and [liquidity-token policy](https://github.com/lenfiLabs/lenfi-smart-contracts/blob/main/validators/liquidity_token.ak):
  the published implementation includes final LP withdrawal and pool destruction
  tied to balance, supply, and manager-NFT conditions.
- [Minswap v2 pool validator](https://github.com/minswap/minswap-dex-v2/blob/main/validators/pool_validator.ak)
  and [factory validator](https://github.com/minswap/minswap-dex-v2/blob/main/validators/factory_validator.ak):
  show authenticated pool lifecycle and liquidity-removal transitions.
- [FluidTokens Lending V4 contracts](https://github.com/FluidTokens/ft-cardano-loans-v4):
  separate pools, requests, loans, repayments, lender bonds, and manager UTxOs,
  illustrating why termination must account for every live liability.
- [Indigo Stability Pool on-chain logic](https://github.com/IndigoProtocol/indigo-smart-contracts/blob/main/src/Indigo/Contracts/StabilityPool/OnChain.hs):
  provides a public reference for share-like stability-pool accounting and
  terminal state constraints.

## Alternatives considered

- Send all dust to the fee recipient: rejected because share-backed rounding
  residuals belong to shareholders, not the fee recipient.
- Leave the vault permanently open at zero supply: rejected because assets and
  storage reserves can become permanently stranded.

## Acceptance gates

- Tests cover even, uneven, profitable, impaired, and fee-bearing final states.
- Burning all shares never leaves positive share-backed assets in an ordinary
  successor state.
- Closure cannot occur with a live request, claim, debt, or fee liability.
