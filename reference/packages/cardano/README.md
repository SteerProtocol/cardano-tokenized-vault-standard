# Cardano construction boundary

`@ctvs/cardano` reuses the workspace's pinned Lucid Evolution and CML for construction checks, resource selection and ledger conversions shared by the separate CTVS clients.

## Ledger conversions

`protocolRef` validates Lucid references through the protocol's canonical hash and output-index rules. `protocolValue` and `ledgerValue` convert between Lucid assets and protocol values; `normalizedValue` validates asset identities with `assetId`, normalizes hex case, rejects duplicate identities and removes zero quantities. They preserve complete asset-name bytes, including CIP-67 labels, and signed quantities for burns. Callers enforce nonnegative custody quantities separately.

CML objects use Lucid's synchronous `withCMLScope`; redeemer readers use CML's `to_flat_format()` for both legacy arrays and maps. Protocol authorization and execution-budget checks remain explicit.

## Complete effects before signing

Fix a `WalletAuthorization` before constructing the transaction. Resolve its inputs from an authenticated provider, choose exact change and permitted extra outputs, and bound network fee and net collateral exposure independently. Do not generate an allowlist from the candidate transaction's outputs.

```ts
const approval = verifyTransactionEffects(unsignedCbor, plan, authorization);
// Present approval.effects, approval.fee and approval.collateralExposure to the wallet.
const signedCbor = await sign(unsignedCbor);
assertApprovedTransaction(signedCbor, approval);
```

The verifier checks all ordinary and reference inputs, protected and additional outputs, change, mint, signers, redeemer purposes/indices/data, script witnesses, value conservation, validity, network and collateral return. It binds the exact original body bytes/hash and non-key witnesses. Signed approval also verifies every required key signature. Complete signed transaction evaluation and ledger acceptance remain separate checks.

The supported reference profile uses Plutus V3, inline protected datums, base/enterprise key funding and change, and explicit reference-script evidence. Metadata, certificates, withdrawals, governance, foreign script spending and unrelated mint are rejected. This is deliberate profile scope. The verifier does not claim to support every valid Cardano transaction shape.

Cardano details are explicit:

- [CIP-31](https://cips.cardano.org/cip/CIP-0031): reference inputs do not contribute spendable value.
- [CIP-32](https://cips.cardano.org/cip/CIP-0032) and [CIP-33](https://cips.cardano.org/cip/CIP-0033): inline datums and reference scripts are separately checked.
- [CIP-40](https://cips.cardano.org/cip/CIP-0040): collateral exposure is the consumed collateral value minus the collateral return; every native asset must return. Funding/collateral overlap is checked for consistent evidence.
- Ledger redeemer indices use canonical input/policy order. Validity-slot bounds must fit inside the authorized POSIX interval, including unaligned boundaries.

## Resource-aware grouping

`selectNextBatch` and `selectNextDelivery` take ordered, atomic groups and a complete construction/evaluation callback. Batch selection reads authenticated State and immutable `maxBatch`; it verifies State did not change during preparation. The next invocation reads a fresh snapshot.

Every candidate is preflighted. Only a measured `ResourceLimitError` for size, memory or steps permits trying a smaller group. Economic, authorization, minimum-ADA and unknown errors propagate. The result contains the prepared transaction, included references, explicit exclusions and every trial. No remainder is silently discarded, and no fixed measured capacity is embedded.

The algorithm tests descending whole-group prefixes. It does not assume globally monotonic economics, split caller-declared dependencies, or claim to find an optimal arbitrary subset. A successful prepared transaction is valid only for its resolved inputs, protocol parameters, funding and witness set. The public callbacks are trusted boundaries; `testing/ledger/selection.ts` demonstrates their real Lucid implementation and signed evaluation.
