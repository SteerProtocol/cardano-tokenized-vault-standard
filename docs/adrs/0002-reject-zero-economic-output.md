# ADR 0002: Reject zero economic output

- Status: Proposed
- Date: 2026-08-27
- Scope: Quotes and executable transitions

## Context

Current floor rounding can quote a positive deposit that mints zero shares. A
caller that accepts `min_shares = 0` can transfer assets to the vault and
receive no claim. The inverse problem exists when a positive share redemption
returns zero assets. Fees can also consume the full economic amount.

Preview functions need to expose rounding results, but a zero-output preview
must not imply that the corresponding transition is executable.

## Decision

Keep pure preview functions total, including their ability to return zero, but
reject any executable transition for which:

```text
gross_assets > 0 and net_assets <= 0
gross_assets > 0 and minted_shares <= 0
burned_shares > 0 and net_assets <= 0
fee_assets >= gross_assets
```

The checks apply in state validators, share policies, batch settlement, and
client-side builders. `min_shares = 0` or `min_assets = 0` cannot override the
nonzero economic-output requirement.

Clients must expose minimum executable deposit, mint, withdraw, and redeem
amounts for the current authenticated state.

## Consequences

- Dust operations fail instead of silently donating value.
- Preview and execution semantics are explicitly different for invalid dust
  amounts.
- Integrators must handle a distinct non-executable quote result.

## Related public implementations

- [Minswap v2 pool validator](https://github.com/minswap/minswap-dex-v2/blob/main/validators/pool_validator.ak):
  validates positive minimum receives, bounded fees, and receiver outputs during
  order application.
- [SundaeSwap order validator](https://github.com/SundaeSwap-finance/sundae-contracts/blob/main/validators/order.ak):
  validates the value and intent carried by order UTxOs before execution or
  cancellation.
- [Lenfi pool validator](https://github.com/lenfiLabs/lenfi-smart-contracts/blob/main/validators/pool.ak)
  and [liquidity-token policy](https://github.com/lenfiLabs/lenfi-smart-contracts/blob/main/validators/liquidity_token.ak):
  couple pool balance changes to LP-token mint and burn behavior.
- [FluidTokens Lending V4 contracts](https://github.com/FluidTokens/ft-cardano-loans-v4):
  include explicit minimum, repayment, liquidation, and bond-accounting rules
  across pools, requests, loans, and repayments.

## Alternatives considered

- Treat zero-share deposits as voluntary donations: rejected because a normal
  vault action must not silently discard the user's claim.
- Rely only on user-provided slippage bounds: rejected because zero bounds are
  valid integers and are frequently used incorrectly by integrations.

## Acceptance gates

- Conformance vectors cover zero shares, zero assets, fee-equals-amount, and
  extreme exchange rates.
- Property tests prove positive executable inputs always produce positive
  economic outputs.
- The existing zero-share fixture is changed from a passing transition to an
  explicitly non-executable quote case.
