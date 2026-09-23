# Security and conformance plan

## Security properties to prove before deployment

### State authentication and succession

- Exactly one UTxO carrying the unique state NFT is the live state.
- Every valid transition consumes it and produces exactly one successor holding the same NFT.
- Config fields cannot change through a normal action and state fields can change only through the selected redeemer.
- Stray UTxOs at the state address do not contribute to `total_assets`.

### Accounting and supply

- The successor satisfies the closed state-value equation for ADA or a native-token underlying.
- `total_assets` excludes accrued fees and the state-storage reserve, while the physical state value accounts for all three categories.
- `new_total_shares = old_total_shares + minted - burned`.
- Shares cannot mint without a collateral-checked state transition.
- Underlying cannot leave custody without the required burn and receiver output.
- Fees accrue by the exact quote amount and can only be collected through an output matching the immutable payout destination.
- A claimant-funded minimum-ADA top-up can never be counted as a fee or a share-backed asset.

### User protection

- Deposit has `min_shares`; mint has `max_assets`.
- Withdraw has `max_shares`; redeem has `min_assets`.
- Receiver address or required inline datum cannot be changed by a third party.
- Datum-hash-only destinations are rejected in v0; each destination requires either no datum or its exact declared inline datum.
- Action is rejected when its validity interval, pause state, or declared limit fails.
- Zero-output and dust cases have an explicit policy and test vector.

### Async-only properties

- Request and claim identity is unique and non-positional.
- A request is settled at most once and a claim is consumed at most once.
- Cancellation cannot steal a settled request.
- A settler cannot exceed the fixed request reward or alter its minimum output.

## Test plan

| Layer | Required proof |
| --- | --- |
| Pure Aiken math | Unit tests for all rounding, virtual balance, fee, and zero edge cases |
| Conformance vectors | A language-neutral JSON suite usable by any future client builder |
| Validator unit tests | Valid and invalid transaction contexts for every direct action |
| Property tests | Conservation, monotonic supply, slippage, and no-free-share properties across random amounts |
| Adversarial tests | Forged state, stale state, wrong NFT, extra mint, wrong output destination or datum, fee-liability mismatch, state-reserve theft, and donation attempts |
| Integration | Real transaction-building tests on a local network or preview environment |
| Review | Independent security review before mainnet deployment or standards publication |

## Existing scaffold coverage

`lib/tests/math_test.ak` covers bootstrap conversion, floor and ceiling behavior, and one-percent entry and exit fee examples. `fixtures/conformance-v0.json` duplicates the core quotes and adds ADA/native-token state-value vectors for fee accrual, withdrawal, and fee collection. `scripts/verify-vectors.mjs` verifies all of them locally.

That coverage tests arithmetic only. The validator files are intentionally inert and no deployment claim should be made until the transaction-level checks above are implemented and reviewed.

The transaction-level suite must include both a key-address destination with no
datum and a script-address destination with an expected inline datum. It must
reject a correct address with the wrong datum, a correct datum at the wrong
address, and a datum-hash-only output. For ADA payouts, it must also prove that
any minimum-output top-up is supplied by a non-vault input.

## Suggested acceptance gates

1. Freeze the wire-format draft and conformance vectors.
2. Complete CTVS-1 state and share policy validators with 100 percent branch coverage of economic paths.
3. Fuzz the conversion and transition invariants.
4. Verify transaction construction with independent client code.
5. Obtain a focused external review of bootstrap, custody, mint/burn coupling, fee claims, ADA reserve accounting, and authority transitions.
6. Only then start a CTVS-2 settlement prototype.
