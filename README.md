# Cardano Tokenized Vault Standard

Two reference implementations of the supplied CTVS v0.6.3 whitepaper, using WIRE-2 and profile 0:

- [CTVS-1](reference/implementations/ctvs1/README.md): synchronous deposit, mint, withdraw and redeem.
- [CTVS-2](reference/implementations/ctvs2/README.md): asynchronous requests, batch settlement, recovery and funded-claim delivery.

Each implementation owns its Aiken contract entrypoint, client API and lifecycle tests. Shared packages hold protocol types, wire encoding, integer accounting and common predicates. The reference workspace uses strict TypeScript, maintained cryptography and serialization dependencies, property tests, measured coverage and signed local transaction tests.

Start with the [reference workspace](reference/README.md), [validation record](reference/VALIDATION.md) and [testing guide](reference/testing/README.md). This is local reference code, with no claim of network deployment, external audit or adopted-standard status.

```sh
cd reference
npm ci --ignore-scripts
# Aiken v1.1.22+39d6b04 must be on PATH, or set AIKEN to its absolute path.
npm run check
```

## Repository organization

| Directory | Purpose |
| --- | --- |
| `reference/implementations/ctvs1/` | Independent synchronous contract project and client |
| `reference/implementations/ctvs2/` | Independent asynchronous contract project and client |
| `reference/packages/` | Shared onchain predicates, TypeScript protocol and planning primitives |
| `reference/testing/` | Local ledger adapter, fixtures and integration tests |
| `reference/tools/` | Reproducible compiler staging and parameter application |
| `docs/` | Earlier design discussion, requirements and proposed architecture decisions |
| Root `lib/`, `validators/`, `fixtures/`, `scripts/` | Preserved V0 planning prototype and its original vector verifier |
| `meeting-site/` | Existing meeting materials |

Architecture changes identified during review are tracked as Proposed records
in [`docs/adrs/`](docs/adrs/README.md). They are not normative until accepted
and reflected in the wire format, transaction rules, vectors, and tests.

The root V0 planning types and inert validator sketches are historical inputs. The current reference projects live under `reference/`; their exact source basis, protocol boundaries and unresolved evidence gates are documented there.
