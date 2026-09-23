# ADR 0008: Generalized owner authorization

- Status: Proposed
- Date: 2026-08-27
- Scope: Request, claim, cancellation, and share-use authority

## Context

Restricting request and claim ownership to a verification-key hash excludes
multisignatures, DAOs, managed vaults, CDPs, and other validators. A receiver
address determines where value goes but does not define who may cancel, settle,
or claim an intent.

## Decision

Replace key-only owners with a versioned authorization algebra that can require
one or more of:

- transaction signature;
- consumption of an authenticated spending input;
- execution of a withdrawal credential;
- execution of a narrowly scoped minting policy;
- a threshold combination of supported conditions.

Owner authorization, success destination, refund destination, and delegated
executor authority must remain separate fields. Each authorization form must
bind to the vault, request identifier, action, and validity interval to prevent
replay or capability reuse.

Share burning by another protocol must be authorized by lawful control of the
share-bearing position and the enclosing protocol's own transition, without
requiring a human wallet signature.

## Consequences

- Protocol-owned positions and atomic composition become possible.
- Authorization validation has a larger attack surface.
- Wallets and indexers need a standard representation for authorization
  requirements.

## Related public implementations

- [SundaeSwap order datum types](https://github.com/SundaeSwap-finance/sundae-contracts/blob/main/lib/types/order.ak)
  and [order validator](https://github.com/SundaeSwap-finance/sundae-contracts/blob/main/validators/order.ak):
  support generic multisignature ownership, including script requirements.
- [Minswap v2 order validator](https://github.com/minswap/minswap-dex-v2/blob/main/validators/order_validator.ak)
  and [sample multisignature script](https://github.com/minswap/minswap-dex-v2/blob/main/validators/sample_multi_sign.ak):
  authorize cancellation through signatures, spending inputs, withdrawals, or
  minting-policy execution.
- [FluidTokens Lending V4 contracts](https://github.com/FluidTokens/ft-cardano-loans-v4):
  document an `authorizer.ak` abstraction for signatures, withdrawals, minting,
  institutional multisignatures, script owners, and permissioned positions.
- [Lenfi collateral validator](https://github.com/lenfiLabs/lenfi-smart-contracts/blob/main/validators/collateral.ak):
  uses authenticated position tokens and transaction conditions for borrower,
  repayment, and liquidation rights.

## Alternatives considered

- Support only keys in v0: rejected because it would freeze non-composable
  ownership into the first published wire format.
- Infer ownership from the receiver: rejected because refund, cancellation,
  and successful delivery are different capabilities.

## Acceptance gates

- Conformance tests cover keys, scripts, multisignatures, and delegated
  capabilities.
- A receiver cannot cancel a request unless separately authorized.
- Capabilities are scoped to one request or an explicitly bounded action set.
- At least one real script-owned integration completes request through claim.
