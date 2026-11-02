# Isolated node acceptance

`npm run test:price-node` is an opt-in acceptance tool, separate from the normal
offline gate. It requires a disposable network with a **fresh issuer key**, magic 42, a funded
test key and Kupo/Ogmios endpoints. It mints issuer-controlled test assets,
registers the provider credential, publishes programs and submits checkpoints.
Do not point it at a public network or an existing funded user wallet.

```sh
CTVS_PRICE_TEST_GENESIS=/path/to/generated/shelley-genesis.json \
CTVS_PRICE_TEST_KEY=/path/to/generated/utxo.skey \
CTVS_PRICE_TEST_KUPO=http://127.0.0.1:18006 \
CTVS_PRICE_TEST_OGMIOS=http://127.0.0.1:18005 \
npm run test:price-node
```

The recorded 29 September run used cardano-node 11.0.1, Ogmios 7.0.0 and Kupo
2.12.0, all in disposable Docker containers with loopback HTTP ports and no
external peers. The [validation record](../../../docs/reviews/2026-09-29-price/README.md)
contains image digests, transaction IDs, actual bytes and execution costs.
That run used the earlier conversion-only provider. The current six-method
provider has a different applied script hash and has not been rerun on a node;
its current verification is compiled Aiken and signed local execution.
The test tool uses the same parameterization and construction code as the local
signed suite. A successful tool run requires node submission and indexed
readback of both witness and reference-script successors. Each checkpoint includes all six methods, with fractional exact-output queries exercising ceiling rounding. It verifies actual
signature witnesses and evaluates final signed CBOR before submission. A third accepted transaction measures 16 mixed-method assertions using
reference scripts.

To prepare an equivalent network with the official image:

1. Use `cardano-cli conway genesis create-testnet-data` with one pool, one stake
   delegator, one UTxO key and magic 42. Keep generated signing keys and databases
   in ignored test artifacts.
2. Use a Conway test configuration with Shelley through Conway hard forks at
   epoch zero, and the corresponding generated genesis files. Pin initial
   protocol version **10.0** and valid Conway cost models. Merely selecting the
   Conway era while retaining the CLI's protocol-version-2 default does not
   activate Plutus V3. Dijkstra is not activated in this run.
3. Align Byron startTime and Shelley systemStart. Use matching security
   parameters, an epoch length consistent with the slot/active-slot settings,
   and a trusted local topology. The run used security parameter 10, 0.2-second
   slots, activeSlotsCoeff 0.5 and 1,000-slot epochs. These are test-network
   timings, not production recommendations.
4. Start the node with the generated pool's KES, VRF and operational certificate.
   Start Ogmios against its socket/config and Kupo from origin, matching all
   outputs. Wait until blocks are produced and both indexers are current.
5. Transfer genesis faucet funds into ordinary outputs with `cardano-cli`; Kupo
   discovers these transactions, whereas the initial genesis allocation alone
   is insufficient for this wallet's indexer discovery. Provide spendable
   ordinary outputs for fees and collateral.
6. Run the command above once with this fresh issuer, inspect the observed
   outputs and retain only non-secret acceptance evidence. Stop the disposable
   containers when finished. For a new bootstrap run, use a fresh issuer key or network: the provider's
   registered credential and minted test identities persist.

Failed local genesis setup is not a provider failure. The initial diagnostic
attempts exposed inconsistent clocks and a protocol-version-2 default; the
accepted run corrected these before executing the Price checkpoints. Resource
limits were not raised to force acceptance: the resulting node limits and fees
are included in the saved evidence. The generated node default permitted
140,000,000 transaction memory units; the offline suite separately verifies this
example under the stricter 14,000,000-unit local envelope. Neither run claims a
universal capacity for arbitrary providers or evidence.

False-price cases in this tool are rejected by the local compiled evaluator
before submission. A third accepted transaction measures 16 mixed-method assertions using
reference scripts. The successful transactions additionally pass actual node
validation. Negative node submission, public deployment, consensus rollback,
production market transitions and independent provider interoperability are
not established by this test.
