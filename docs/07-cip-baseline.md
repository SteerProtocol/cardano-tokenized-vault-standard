# Active CIP baseline

## Policy

CTVS v0 takes a conservative dependency policy:

1. A normative CTVS dependency must be an **Active** CIP when adopted.
2. The contract must not depend on a CIP whose required companion format is Proposed, Under Review, candidate-only, or otherwise pre-release.
3. Optional compatibility metadata must never determine custody, share supply, authorization, or quote correctness.
4. A CTVS implementation must not claim that optional support is universal ecosystem support.

This is a frozen planning baseline, checked against the official CIP registry on 2026-08-18. Recheck status before release because CIP status can change.

## Use in CTVS v0

| CIP | Registry status | CTVS role | Decision |
| --- | --- | --- | --- |
| [CIP-19](https://cips.cardano.org/cip/CIP-0019) | Active | Cardano address representation | Use ledger address values in datums and output destinations. Do not encode Bech32 text in on-chain data. CTVS-1 state addresses have no staking credential. |
| [CIP-31](https://cips.cardano.org/cip/CIP-0031) | Active | Reference inputs | Use when a static config, manifest, or reference script must be read without consuming it. Do not mistake reference input use for state mutation. |
| [CIP-32](https://cips.cardano.org/cip/CIP-0032) | Active | Inline datums | Use for visible state, request, and configured output datums. This simplifies deterministic transaction construction and avoids off-chain datum distribution. |
| [CIP-33](https://cips.cardano.org/cip/CIP-0033) | Active | Reference scripts | Recommended deployment optimization. It lowers repeated transaction witness cost but is not part of the economic security model. |
| [CIP-40](https://cips.cardano.org/cip/CIP-0040) | Active | Collateral outputs | Builders must correctly fund collateral and any return output. Collateral never comes from the state, share backing, accrued fees, or storage reserve. |
| [CIP-55](https://cips.cardano.org/cip/CIP-0055) | Active | Minimum lovelace per UTxO byte | Use the current `coinsPerUTxOByte` parameter and serialized output size to size state, config, request, claim, and destination-output reserves. Do not hard-code a mainnet value. |
| [CIP-57](https://cips.cardano.org/cip/CIP-57) | Active | Plutus contract blueprint | Required release artifact. Publish every validator, parameter, datum, and redeemer schema together with the conformance vectors. |
| [CIP-89](https://cips.cardano.org/cip/CIP-0089) | Active | Distributed dApp and beacon-token design pattern | Optional CTVS-2 profile for user-owned request and claim UTxOs. Do not require it for CTVS-1 direct custody. |
| [CIP-88](https://cips.cardano.org/cip/CIP-0088) | Active | Token-policy capability registration | Optional discovery record for the share policy. It can describe intent but cannot replace CTVS on-chain validation. |

## Integration-only active CIPs

These are useful for tools around a vault, not part of the CTVS contract definition.

| CIP | Use only when needed |
| --- | --- |
| [CIP-30](https://cips.cardano.org/cip/CIP-0030) | Browser wallet integration for a web transaction builder. |
| [CIP-8](https://cips.cardano.org/cip/CIP-0008) | Future off-chain signed intent or scoped-permit design. It is not an authorization substitute in CTVS-1. |
| [CIP-5](https://cips.cardano.org/cip/CIP-0005) | Human-readable Bech32 rendering of hashes and identifiers in the manifest, CLI, and UI. |
| [CIP-26](https://cips.cardano.org/cip/CIP-0026) | Optional off-chain display metadata for a share token. It never controls protocol behavior. |

## Explicit exclusions

| CIP or family | Current issue | CTVS v0 decision |
| --- | --- | --- |
| [CIP-67](https://cips.cardano.org/cip/CIP-0067) | **Proposed** asset-name label registry | Do not use its label scheme or request a CTVS asset label. |
| [CIP-68](https://cips.cardano.org/cip/CIP-0068) labeled 100/333 profiles | CIP-68 is Active, but its native-asset label construction normatively follows Proposed CIP-67 | Do not make CIP-68 metadata or labeled reference NFTs a CTVS v0 requirement. A share asset remains a normal native asset identified by the authenticated vault config and state NFT. |
| [CIP-143](https://cips.cardano.org/cip/CIP-0143) and candidate CIP-113 work | CIP-143 is Inactive and incorporated into candidate CIP-113 | Do not build programmable or permissioned share transfer logic on it. CTVS shares remain ordinary native assets. |
| CIP-25 metadata | Active, but transactional metadata is not an authenticated vault-interface or accounting source | It may be emitted later for wallet display compatibility, but is never a security or discovery dependency. |

## Practical implementation baseline

For the first deployable CTVS-1 prototype, use only:

```text
CIP-19 ledger Address representation
CIP-31 immutable config reference input
CIP-32 inline state datum
CIP-57 generated blueprint
ordinary native share asset
one-shot state NFT
state transition validator and coupled share policy
```

Use CIP-40-compatible collateral construction and CIP-55 output-reserve sizing in every builder. Add CIP-33 only when reference-script deployment actually adds value. Keep CIP-88 and CIP-89 optional until we have a concrete wallet or async-settlement integrator asking for them.

This gives us no dependence on a pre-release CIP while preserving a clean future path for discovery and asynchronous requests.
