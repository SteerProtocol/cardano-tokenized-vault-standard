# References and prior discussion

## Primary implementation and standard references

- [ERC-4626: Tokenized Vault Standard](https://eips.ethereum.org/EIPS/eip-4626)
- [OpenZeppelin ERC4626 implementation](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/token/ERC20/extensions/ERC4626.sol)
- [OpenZeppelin ERC4626 fee extension](https://github.com/OpenZeppelin/openzeppelin-community-contracts/blob/master/contracts/token/ERC20/extensions/ERC4626Fees.sol)
- [Solady ERC4626 implementation](https://github.com/Vectorized/solady/blob/main/src/tokens/ERC4626.sol)
- [Aiken project structure and build documentation](https://aiken-lang.org/fundamentals/getting-started)
- [Aiken eUTxO overview](https://aiken-lang.org/fundamentals/eutxo)
- [Aiken state-thread-token explanation](https://aiken-lang.org/faq)
- [Aiken address types](https://aiken-lang.github.io/stdlib/cardano/address.html)
- [Cardano transactions](https://developers.cardano.org/docs/learn/core-concepts/transactions/)
- [Cardano native tokens](https://docs.cardano.org/developer-resources/native-tokens)
- [CIP-19 Cardano Addresses](https://cips.cardano.org/cip/CIP-0019)
- [CIP-40 Collateral Output](https://cips.cardano.org/cip/CIP-0040)
- [CIP-55 Protocol Parameters (Babbage Era)](https://cips.cardano.org/cip/CIP-0055)
- [CIP-57 Plutus Contract Blueprint](https://cips.cardano.org/cip/CIP-57)
- [CIP-88 Token Policy Registration](https://cips.cardano.org/cip/CIP-88)
- [CIP-89 Distributed dApps and Beacon Tokens](https://cips.cardano.org/cip/CIP-89)

The full dependency decision, including active-only requirements and explicit exclusions, is in `07-cip-baseline.md`.

## Earlier planning discussion

This scaffold is based on [Cardano Token Standards](chatgpt-conversation://6a7f82ed-f2f8-83ea-a9a6-ca7643e35162). The conversation's final corrective decision was especially important: standardize the vault boundary and leave strategy internals implementation-specific.

Key retained conclusions:

- Native assets make a separate ERC-20 transfer interface unnecessary for vault shares.
- A Cardano analogue needs canonical transaction rules and schemas rather than EVM method selectors.
- An authenticated singleton state UTxO and a coupled share mint or burn policy are the minimum viable accounting surface.
- Direct actions are useful but serialize state. Asynchronous requests are a separate scalability extension.
- Accounting profile and NAV authority must be explicit, especially for managed strategies.
- ADA can be supported when share backing, fee liabilities, and UTxO storage ADA are separated explicitly.
- A standard should disclose an authority's capabilities without prescribing the governance system behind it.

## Reference interpretation note

The materials above inform this planning proposal. They do not establish that CTVS is the first Cardano vault standard, that a particular CIP will be adopted, or that this scaffold is secure for deployment. Those claims require a broader ecosystem review, consensus process, complete implementation, and independent security assessment.
