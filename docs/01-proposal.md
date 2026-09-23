# CTVS v0 proposal

## Status and claim boundary

CTVS means Cardano Tokenized Vault Standard. It is a working name for this planning project, not a submitted Cardano Improvement Proposal and not a claim of ecosystem adoption or novelty.

The proposal translates the economic and integration principles of ERC-4626 into Cardano's eUTxO model. An EVM standard exposes methods on a persistent contract. A Cardano standard must instead define authenticated UTxOs, datum and redeemer schemas, required transaction shapes, deterministic quote math, and indexer-visible action records.

## Scope selected from the earlier planning discussion

The earlier discussion began with a broader graph of positions, workflows, liquidity lanes, and strategies. Its final conclusion was to remove that internal operating system from the base standard. The resulting v0 scope is intentionally narrow:

| In scope | Out of scope for v0 |
| --- | --- |
| One underlying asset and one native share asset | Multi-asset deposit or redemption |
| Authenticated `VaultState` and custody | A universal ALM, lending, or DEX position format |
| Total assets, total shares, fees, limits, and rounding | A universal valuation adapter or risk engine |
| Direct deposit, mint, withdraw, and redeem | A global request queue or FIFO promise |
| Optional request, settlement, and claim extension | Strategy workflow state machines |
| Datum/redeemer schemas and conformance vectors | ERC-20-style unlimited allowances |

A basket or an ALM vault can still conform. It simply presents one deposit and redemption asset at the standard boundary while retaining its own internal position layout and accounting machinery.

## Standard modules

### CTVS-0: discovery and manifest

Every conforming deployment needs an authenticated machine-readable descriptor. The first version should publish it in a CIP-57 blueprint plus a manifest reference that identifies:

- specification version and capability flags;
- vault ID, state-NFT asset, underlying asset, and share asset;
- state, share-policy, and optional request validator hashes;
- accounting profile and virtual-balance parameters;
- fee payout destination, accrued-fee model, limits, authority surface, upgrade policy, and metadata reference;
- reference-script locations and off-chain builder compatibility.

The current project models this document but does not select an on-chain manifest encoding yet. That choice should reuse existing Cardano discovery and metadata conventions where appropriate rather than inventing another registry.

The [Active CIP baseline](07-cip-baseline.md) governs this choice. It permits only Active CIPs as normative dependencies and intentionally does not use the CIP-68 asset-label profile because its labeling convention is in Proposed CIP-67.

### CTVS-1: synchronous tokenized vault

This is the direct ERC-4626 analogue. A direct action consumes the current state UTxO, produces exactly one successor state UTxO, and either mints or burns the native share asset. The first concrete implementation profile is `direct_custody`.

### CTVS-2: asynchronous requests

This is the ERC-7540-like extension. A user creates a request UTxO without contending on the singleton state. A settler later batches compatible requests with the state transition and produces individually claimable outputs. See `03-async-extension.md`.

### CTVS-3: scoped operator capability

This is intentionally postponed. If delegated redemption is required, it should be explicit and bounded by vault, allowed action, amount cap, expiration, nonce, and receiver restriction. Native share transfers do not require a contract-controlled allowance model.

## CTVS-1 direct-custody profile

The first implementation profile makes share-backed `total_assets` objectively checkable on-chain. The immutable config UTxO is supplied as a CIP-31 reference input, while the mutable state UTxO is consumed and recreated:

```text
non-ADA: total_assets = state[underlying] - accrued_fee_assets
ADA:     total_assets = state.lovelace - accrued_fee_assets - state_storage_lovelace
```

Only the UTxO carrying the unique state NFT counts. `accrued_fee_assets` are owed to the immutable fee payout destination and never back shares. `state_storage_lovelace` exists only to keep the UTxO ledger-valid. Tokens sent to the same script address without the state NFT are not custody and do not affect share price. Unlike an EVM vault balance, an authenticated Cardano UTxO cannot receive an external donation without being consumed and recreated, so the state validator can reject an unaccounted delta.

Managed strategies, lending positions, and externally attested NAV are valid later accounting profiles, but they must declare a source of truth, authority, freshness window, loss treatment, and upgrade or emergency policy. They must not be silently treated as `direct_custody`.

## Semantic mapping

| ERC-4626 concept | CTVS equivalent |
| --- | --- |
| ERC-20 vault share | Cardano native share asset controlled by a minting policy |
| `asset()` | Manifest and immutable state fields |
| `totalAssets()` | Share-backed `total_assets` in the authenticated state datum plus its direct-custody value equation |
| `totalSupply()` | State datum supply counter checked against mint and burn delta |
| `convertTo*` | Pure client-side function against an identified state UTxO |
| `preview*` | Action-specific client-side function plus exact on-chain validation |
| `deposit`, `mint`, `withdraw`, `redeem` | Canonical transaction shapes and typed redeemers |
| events | Typed redeemers, state succession, mint/burn values, and destination-matched outputs |
| ERC-20 allowance | Optional bounded capability, never part of CTVS-1 |

## Canonical math

Let `A` be accounted assets, `S` be total shares, `Va` be immutable virtual assets, and `Vs` be immutable virtual shares. The initial proposal uses `Va = 1` and lets the manifest choose an immutable positive `Vs` share scale.

```text
convert_to_shares(assets) = floor(assets * (S + Vs) / (A + Va))
convert_to_assets(shares) = floor(shares * (A + Va) / (S + Vs))
```

The conversions are fee-free average-price views. The four action previews use these directions:

| Action | User fixes | Preview result | Required rounding |
| --- | --- | --- | --- |
| Deposit | gross asset input | shares received | Down |
| Mint | shares received | gross assets required | Up |
| Withdraw | net assets received | shares required | Up |
| Redeem | shares burned | net assets received | Down |

Virtual balances improve the empty-vault behavior and should be immutable. They are accounting constants only, never assets that a user may withdraw.

## Reference implementation alignment

The proposal intentionally takes economic behavior from the two requested reference implementations, while changing the execution interface to fit Cardano:

| Reference behavior | CTVS decision |
| --- | --- |
| OpenZeppelin and Solady both use virtual balances by default | Preserve virtual asset and share constants, but authenticate custody with a state NFT rather than an account balance |
| Both use down rounding for deposit and redeem, up rounding for mint and withdraw | Preserve all four directions in the Aiken math kernel and conformance vectors |
| Base ERC-4626 implementations keep conversions fee-free | Keep `convert_to_*` fee-free and make fee-bearing previews explicit |
| OpenZeppelin's fee extension uses ceiling fee calculations | Reuse `fee_on_raw` and `fee_on_total`; accrue the exact fee as a recipient liability so ADA dust does not require an oversized output |
| ERC-20 allowances authorize a vault to pull shares | Replace with share-bearing inputs plus an owner signature, with scoped delegation deferred to CTVS-3 |

The source code links are recorded in `06-references.md`. The important translation is not a line-by-line Solidity port: the same economic invariants are enforced by a full eUTxO transition rather than a method call against globally stored contract balances.

## Built-in accrued fees

Every CTVS-1 vault config fixes a fee payout destination and entry and exit rates. A rate of zero turns off that charge. If a rate is nonzero, all quote and execution paths must use the same formula. The fee is charged economically in the user action and accrued in the state, then collected through a permissionless template-matching `ClaimFees` action. This is a Cardano storage choice, not a change to the quote.

```text
fee_on_raw(x, bps)   = ceil(x * bps / 10_000)
fee_on_total(x, bps) = ceil(x * bps / (10_000 + bps))
```

The resulting action semantics are:

```text
deposit(gross):
  fee = fee_on_total(gross, entry_bps)
  shares = convert_to_shares_down(gross - fee)

mint(shares):
  net = convert_to_assets_up(shares)
  gross = net + fee_on_raw(net, entry_bps)

withdraw(net):
  gross = net + fee_on_raw(net, exit_bps)
  shares = convert_to_shares_up(gross)

redeem(shares):
  gross = convert_to_assets_down(shares)
  net = gross - fee_on_total(gross, exit_bps)
```

The Aiken module in `lib/ctvs/math.ak`, the proposed [`lib/ctvs/wire.ak`](../lib/ctvs/wire.ak) schema, and the JSON fixture file are normative for this planning revision. They need independent review before becoming a published specification. The authority, ADA, and fee-collection rules are recorded in [08-authority-ada-fees-and-wire-format.md](08-authority-ada-fees-and-wire-format.md).
