# Decisions and remaining questions

## Settled for the CTVS-1 planning profile

| Topic | Decision |
| --- | --- |
| Scope | One underlying asset, one native share asset, direct custody. Strategy internals stay outside the standard. |
| ADA | Supported. The state output separates share-backed ADA, accrued fees, and a non-economic storage reserve. |
| Fees | Required config fields: payout destination, entry rate, and exit rate. Zero rates are valid. Fees accrue in state and are permissionlessly collected by template-matching payout. |
| Authority | CTVS standardizes the limited capability surface, not governance. CTVS-1 permits only pause and resume authority. Economics, routing, and upgrades are immutable. |
| Upgrades | No in-place upgrade. A migration is a new disclosed vault/version. |
| Wire format | Aiken types in `lib/ctvs/wire.ak`, then generated CIP-57 blueprint plus golden CBOR fixtures. |
| Async identity | Originating `OutputReference` or authenticated beacon, never input or output position. |
| CIP policy | Only Active CIPs are normative dependencies. |

The detailed rationale and precise value invariants are in
[08-authority-ada-fees-and-wire-format.md](08-authority-ada-fees-and-wire-format.md).

## Required before CTVS-1 coding

1. **Bootstrap scale**: Is `virtual_shares` always `1`, or does the immutable config set it from a share-display scale? The current tests use `1:1` base units.
2. **Factory and terminal closure**: What exact one-shot factory anchor creates the config and state NFTs, and after `total_assets = accrued_fee_assets = total_shares = 0`, who may close them and receive each declared storage reserve?
3. **Reserve sizing**: What conservative initialized `state_storage_lovelace` and `config_storage_lovelace` cover the maximum v0 datum and value footprint? Which network parameter source and test environment establish those numbers?
4. **Config placement confirmation**: This draft uses a separate immutable config UTxO through CIP-31 reference inputs. Confirm that the extra reference input is acceptable for the target wallet/building stack.
5. **Output-destination interoperability**: Confirm target wallets and builders can create receiver, refund, reserve-return, and treasury outputs carrying user-declared inline data. Ordinary key-address destinations with no datum remain the common case.
6. **Authority rollout**: Is CTVS-1 limited to `NoPauseAuthority` and `PauseKey`, with `PauseCapability` retained as a schema slot but not enabled until a script-capability test suite exists?

## Required before CTVS-2 coding

1. **Pricing**: Does a request settle at the state it is included in, a committed epoch snapshot, or a signed NAV report?
2. **Cancellation**: Can a user cancel until selection, after a deadline, or both? What prevents a settlement-cancel race?
3. **Fairness**: What ordering policy is declared, given that global FIFO is not a safe default claim?
4. **Rewards and refunds**: Is the fixed user-precommitted settler reward sufficient, and how is unused budget returned?
5. **Liveness**: What enables permissionless settlement or a fallback path if the primary settler stops operating?
6. **Claims**: Are claims immediate direct outputs when possible, or always separate claim UTxOs?

## Deferred accounting profiles

`direct_custody` is the first profile because its assets are locally checkable.
The next profile should be selected only after CTVS-1 works:

- **Composed positions**: Requires an authenticated position set and protocol-specific valuation adapters.
- **Attested NAV**: Requires a signer set, report freshness, loss rules, and an emergency policy.
- **Hybrid liquidity plus strategy**: Requires an explicit distinction between immediately redeemable liquidity and long-horizon managed positions.

No profile should call itself CTVS-1 direct custody if its `total_assets` relies on an external oracle, position valuation, or discretionary accounting update.
