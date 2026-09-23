# Reference implementation limitations

## Hybrid vault support

A **hybrid vault** uses different execution paths for deposits and withdrawals within the **same vault**, sharing one underlying asset, share token and accounting state.

For example: deposits issue shares immediately, but withdrawals create requests that a settler processes later.

| Deposits | Withdrawals | Current implementation |
| --- | --- | --- |
| Immediate | Immediate | CTVS-1 |
| Request and settlement | Request and settlement | CTVS-2 |
| Immediate | Request and settlement | Not implemented |
| Request and settlement | Immediate | Not implemented |

The whitepaper permits all four arrangements. Our compiled contracts currently support the first two arrangements and reject the mixed combinations.

So this is a **gap in our implementation's supported configurations**. The shared wire format can describe a hybrid vault, but we haven't supplied and validated a contract build that executes it.

## Permanently entry-only vaults

**For this reference profile, permanently entry-only vaults are almost never appropriate.** An immutable entry-only vault accepts assets and issues shares but provides no way to redeem them. Transferable shares let someone sell their position, but do not create a route to recover the backing.

Entry-only behavior can make sense in a different lifecycle:

- **Subscription period:** accept deposits before withdrawals open.
- **Temporary withdrawal suspension:** keep deposits open while exits are paused, with clearly disclosed risks.
- **Externally settled product:** shares receive payouts through a separate distribution, maturity or migration mechanism.

Each requires an additional mechanism. Our current profile has immutable mode bits and no scheduled mode transition, maturity distribution or migration path. Those examples therefore do **not** justify permanently entry-only deployments here.

### Proposed genesis restrictions

For this reference implementation, I would reject modes **`1`, `4` and `5` at genesis**, alongside exit-only modes **`2`, `8` and `10`**. Require at least one entry path and one exit path, then use separately defined controls for temporary restrictions.

This is a concrete specification improvement: **a valid capability bitmask is not necessarily a valid vault lifecycle.**

## Integration and validation boundary

The [five-finding remediation](docs/reviews/2026-09-18-remediation/README.md) adds recovery compatibility, complete wallet-effects verification, measured resource selection and a rollback-aware reference reader. The reader requires a trusted accepted-block feed and reviewed script builds; its retained integration tests use signed local transactions and synthetic block points. Node-backed acceptance/rollback, operational persistence, public-network deployment and independent interoperability remain unverified. These additions do not change the hybrid or one-sided mode limitations above.
