# Authority, ADA, fees, and wire format

This planning decision resolves four CTVS-1 questions. It intentionally
adopts the small, direct-custody design from the prior discussion rather than
turning the standard into a strategy or governance framework.

## What ERC-4626 settles, and what it does not

ERC-4626 supplies the economic contract:

| Settled by ERC-4626 and its implementations | CTVS must decide itself |
| --- | --- |
| One asset and one transferable share boundary | UTxO identity, state authentication, and native-asset encoding |
| Fee-free `convertTo*` views and fee-bearing action previews | Recipient storage and fee collection timing |
| Deposit and redeem round down; mint and withdraw round up | ADA storage reserves, transaction-fee funding, and closed-value rules |
| Deposit, mint, withdraw, redeem, limits, and user bounds | Authority proof, governance disclosure, upgrades, and migration |
| Action intent and slippage semantics | Datum/redeemer constructors, output templates, async batching, and request identity |

ERC-4626 deliberately leaves vault allocation and accounting internals open.
It therefore cannot answer the Cardano-native questions on the right. CTVS
should preserve its economic guarantees while making those ledger choices
explicit. See [ERC-4626](https://eips.ethereum.org/EIPS/eip-4626).

## Decision: authority is capability disclosure, not governance

The standard should say exactly who can perform a privileged transition and
which transition that is. It should not dictate whether that key or script is
owned by a DAO, multisig, company, or individual.

An address is a payment destination, not enough by itself to prove generic
authority:

- A key authority is a verification-key hash. The validator checks that it is
  a member of `extra_signatories`.
- A script or multisig authority is a capability UTxO. The privileged action
  must consume its configured token at its configured address and recreate it
  there. Spending a script-locked capability makes that script validate the
  transaction.

CTVS-1 freezes all economics and routing: underlying, share, virtual balances,
limits, fee rates, fee payout destination, and validator version. It permits only
`Pause` and `Resume` through the closed `PauseAuthority` type. It has no
in-place upgrade or asset-sweep power. A migration is a newly deployed vault
with a clearly disclosed conversion and exit process.

`TopUpStateReserve` is intentionally not privileged. It can only add external
ADA to the non-economic storage reserve and cannot change shares, fee debt, or
share-backed assets. Anyone choosing to fund it cannot later recover it except
through the terminal reserve-return rule.

## Decision: ADA is supported in CTVS-1

ADA is not excluded. It is a native ledger asset just like a native token for
the vault boundary. The extra rule is necessary because every UTxO needs ADA
for storage and transaction fees themselves are paid in ADA. Under the current
Babbage formula, the minimum output requirement depends on serialized output
size and the live `coinsPerUTxOByte` parameter. [CIP-55](https://cips.cardano.org/cip/CIP-0055)
is Active and specifies that formula.

CTVS separates three things that must never be conflated:

1. `total_assets`: assets backing issued shares and used by all conversions.
2. `accrued_fee_assets`: already charged assets owed to the configured fee
   recipient, not to shareholders.
3. `state_storage_lovelace`: ADA retained solely to keep the state UTxO valid.

The state output is closed. It contains exactly the state NFT, the underlying
asset when it is non-ADA, and the lovelace stated by the following invariants:

```text
ADA underlying:
  state.lovelace
  = total_assets + accrued_fee_assets + state_storage_lovelace

Non-ADA underlying:
  state[underlying]
  = total_assets + accrued_fee_assets
  state.lovelace
  = state_storage_lovelace
```

No other asset may appear in the state output. Ordinary deposit, mint,
withdraw, redeem, pause, resume, and fee-claim transitions preserve
`state_storage_lovelace`. A top-up can only increase it from an external ADA
input. Network fees must be supplied from non-vault inputs, never by silently
reducing the state reserve or economic balance. Cardano's ledger balance rule
and minimum-ADA requirement make this explicit. See [Cardano transactions](https://developers.cardano.org/docs/learn/core-concepts/transactions/).

For the direct-custody profile, the state script address must be an enterprise
address with no staking credential. That prevents separately accruing staking
rewards from becoming undocumented managed ADA. Aiken represents an address as
a payment credential plus optional stake credential, which is why CTVS uses
the ledger `Address` type rather than a Bech32 string. See [Aiken address types](https://aiken-lang.github.io/stdlib/cardano/address.html)
and [CIP-19](https://cips.cardano.org/cip/CIP-0019).

## Decision: a built-in accrued-fee payout model

Every CTVS-1 config has a full `payout`, `entry_fee_bps`, and
`exit_fee_bps`. Either rate may be zero. Rates and recipient are immutable
after deployment. This is a built-in model, not a bolt-on extension.

Fees are charged at the same moment as the corresponding user action, but are
accrued inside the authenticated state UTxO instead of creating a fee output
for every action. This avoids forcing a tiny ADA fee to become a much larger
minimum-ADA output, while preserving the same user quote:

```text
deposit or mint:
  total_assets increases by net_assets
  accrued_fee_assets increases by fee_assets

withdraw or redeem:
  total_assets decreases by gross_assets
  accrued_fee_assets increases by fee_assets
  receiver receives net_assets
```

The state-value equation then accounts for every supplied asset exactly. The
fee cannot dilute existing shares because it is excluded from `total_assets`
immediately, even though physical collection happens later.

`ClaimFees` is permissionless and claims the entire accrued balance. It
consumes the state, sets `accrued_fee_assets` to zero, keeps `total_assets` and
`total_shares` unchanged, and creates a payout output matching the configured
`OutputDestination`: its address and its optional inline datum.
For a token underlying, that output contains exactly the economic fee amount
of that token. For ADA, it contains at least the economic fee amount; any
additional lovelace is an explicit claimant-funded output top-up, never vault
value or an extra fee. CTVS deliberately imposes no `FeeReceipt` datum on the
payout output, because a script recipient may need that datum slot for its own
spending rules. Indexers identify the collection from the `ClaimFees` redeemer
and the authenticated state delta.

The next standard version may define a separate fee-escrow performance profile
if fee collection contention becomes material. It is deliberately not part of
the first small profile.

## Decision: freeze an Aiken-first wire format

[`lib/ctvs/wire.ak`](../lib/ctvs/wire.ak) is the proposed v0 schema. It uses
ledger-native Aiken types:

```aiken
pub type AssetId {
  Ada
  NativeAsset { policy_id: ByteArray, asset_name: ByteArray }
}
```

This avoids the ambiguous empty-byte sentinel for ADA. On-chain validation
requires a native policy ID to be 28 bytes, an asset name to be at most 32
bytes, and vault/state/share/capability identifiers to be distinct non-ADA
assets.

Every configured destination uses the same ledger-native form:

```aiken
pub type OutputDestination {
  OutputDestination {
    address: Address,
    inline_datum: Option<Data>,
  }
}
```

`None` requires an output with no datum. `Some(datum)` requires an output with
that exact inline datum. Datum-hash-only outputs are outside v0. This lets a
fee collector, receiver, refund target, or terminal reserve return use a
script address without making CTVS understand the receiving script's
governance or state machine.

The wire topology is:

```text
immutable config UTxO + vault-id NFT
  referenced, never consumed, by normal transitions

mutable state UTxO + state NFT
  consumed and recreated by every CTVS-1 action

native share policy
  coupled to the authenticated state transition
```

The config datum contains all immutable parameters. The state datum contains
only current accounting and reserve state. Every normal state transition uses
the config UTxO as a reference input, verifies its vault-ID NFT, and requires
the same `vault_id` in the state datum. This keeps immutable config
machine-readable without duplicating it in every state datum.

Direct actions, async receivers and refunds, fee payouts, and terminal reserve
returns use `OutputDestination`. The validator identifies a payment output by
matching its address and inline datum, then checks the exact economic asset
quantity for a native token or at least the economic lovelace for ADA. Any ADA
above the economic amount is an externally funded output top-up. A validator
must not infer a payment by summing arbitrary change outputs sent to the same
address, and it must not require a CTVS receipt datum that would conflict with
a receiving script's datum.

Constructor and field order in an Aiken data type become PlutusData
compatibility commitments. Before release we must generate the [CIP-57](https://cips.cardano.org/cip/CIP-0057)
blueprint from these types and publish golden CBOR fixtures for every datum and
redeemer. A new incompatible format is a new version, never a reordered v0
datum.

## Async consequence

CTVS-2 keeps request identity as its originating `OutputReference`. For ADA,
three amounts must be separate in the datum and value rule:

```text
request_lovelace
= offered_assets, when the underlying is ADA
+ request_storage_lovelace
+ settler_reward_lovelace
```

Only offered assets affect shares. The storage reserve is carried to a claim
or refund output. The user-precommitted settler reward has its own payout and
refund rules. The transaction's own network fee comes from neither category.
