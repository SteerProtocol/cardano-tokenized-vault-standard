# LendingA Price binding

This is an isolated, hypothetical provider and receipt checkpoint. It is not an
approved deployment or a production lending implementation.

| Binding item | Exact rule |
| --- | --- |
| Encoding | `Price`, encoded version 1, Appendix B of CTVS-1 |
| Supported methods | ConvertToAssets, ConvertToShares, PreviewDeposit, PreviewMint, PreviewWithdraw and PreviewRedeem under the no-fee snapshot rules below |
| Provider identity | Hash of the applied Plutus V3 withdrawal program, including Config parameters |
| Consumer binding | Applied consumer parameters fix provider hash, market NFT and both asset identities |
| Config | Constructor 0: market Asset, receipt Asset, underlying Asset, native state Address |
| Evidence | Constructor 0: one OutputReference, itself constructor 0 with bytes32 transaction ID and index 0..65,535 |
| Authentication | Exactly one referenced output at the configured script address, holding exactly one configured market NFT, with inline native datum |
| Native datum | Constructor 0: nonnegative bounded accounted underlying units, strictly positive bounded receipt supply |
| Pricing basis | Referenced ledger snapshot, no timestamp-based accrual; source must be a reference input, not a consumed state input |
| Result | All six formulas below, after applicable native liabilities under the assumed accounting; every result must equal the exact bounded claim |
| Units | Share quantities/supply use receipt base units; asset quantities/backing use underlying base units. Display metadata is never a pricing parameter |
| Fees/bootstrap | No operation fees, virtual shares or zero-supply bootstrap in this example |
| Signed reports | Unsupported. There is no accepted reporter, signature scheme, domain or freshness contract |
| Liquidity | No withdrawal promise, reservation or available-liquidity assertion |
| Composition | Isolated checkpoint only. Existing Direct Custody Profile validators, planners and wallet policies still forbid these withdrawals |

With backing `B` and supply `S`, the provider verifies:

| Assertion | Exact result |
| --- | --- |
| ConvertToAssets | floor(shares times B / S) |
| ConvertToShares | floor(assets times S / B) |
| PreviewDeposit | floor(assets_in times S / B) |
| PreviewMint | ceil(shares_out times B / S) |
| PreviewWithdraw | ceil(assets_out times S / B) |
| PreviewRedeem | floor(shares_in times B / S) |

Supply must be positive. At zero backing, ConvertToAssets and PreviewRedeem
verify zero value; the other four methods reject, including zero-input queries.
At positive backing, all six accept zero input only with zero result. Ceiling
uses exact integer arithmetic; claims outside 0..2^63-1 are rejected rather than
clamped. Queries are quotes for this state basis, not an executed transfer,
share mint/burn or promise of withdrawal capacity.

An 8-decimal receipt and 6-decimal underlying use the same exact integer formula:
50,000,000,000 receipt units with supply 100,000,000,000,000 and backing
1,100,000,000,000 yield 550,000,000 underlying units. A metadata exponent change
cannot alter this result. A rate oracle reporting a scaled ratio would need a
different provider binding that authenticates the exponent and rounding.

The generic envelope permits 1..16 unique queries with quantities in 0..2^63-1.
Evidence is bounded to 1,024 normalized bytes, 256 nodes, depth 16, signed
256-bit integers, constructor tags 0..127 and no duplicate map keys. LendingA's
evidence has a much narrower exact shape. It does not accept arbitrary bounded
Data as economic evidence.

Compiled code can appear as a witness or be published on a reference-script
UTxO. Publication does not invoke it. A zero withdrawal invokes the provider;
spending the receipt checkpoint invokes the consumer. State and code-reference
outputs are read rather than consumed. A checkpoint spend consumes only its
receipt position and ordinary wallet funding, then recreates the full position.

The signed fixtures derive all hashes from applied programs and record their
values in ignored `artifacts/price-signed/*/binding.json`. There is deliberately
no fixed public deployment hash or canonical code location in this binding.
Builders must discover the current unspent market NFT source, authenticate its
address, read its datum, calculate the claim and select verified program bytes.
The fixture uses Lucid's provider interface with either the local emulator or
an isolated Cardano node through Kupo/Ogmios. The recorded node acceptance is
limited to the earlier conversion-only program snapshot. The current all-six
provider is verified through compiled handlers and signed local transactions;
its changed applied hash requires a new approved consumer binding and code
publication. A retained node trace does not validate that new hash.
Production discovery and public deployment remain
separate requirements.

The upstream protocol must enforce NFT uniqueness, supply and accounting
transitions. This adapter cannot prove those guarantees by inspecting a datum.
Its valuation is not an absolute whole-vault NAV report and must not replace a
consumer's debt, cash-flow, fee or custody reconciliation.
