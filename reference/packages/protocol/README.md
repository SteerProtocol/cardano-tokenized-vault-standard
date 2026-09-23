# Protocol primitives

`@ctvs/protocol` contains shared WIRE-2 Data types, exact integer economics and wire validation for the two reference implementations. It does not select UTxOs, balance transactions or submit transactions.

- `src/math/` implements quantity bounds, rounding, fee quotes, transitions and economic deposit limits.
- `src/wire/` implements typed datum and role-specific action encodings. Recovery projection deliberately leaves an unsupported economic request body uninterpreted.
- `src/data/` represents ordered Plutus Data, checks bounded opaque recipient data, and adapts maintained serialization libraries.
- `src/hash.ts` uses `@noble/hashes` BLAKE2b with a 32-byte output. `termsHash` applies the whitepaper's domain prefix before hashing.

The HarmonicLabs libraries own generic CBOR parsing, byte encoding and Plutus Data construction. The adapter preserves the candidate's definite, ordered maps; enforces Plutus byte chunks and constructor tags; supports legal empty integer magnitudes; and rejects trailing data. The library scanner runs before configured structural budgets and may reject extreme nesting at its runtime limit. That case is reported as an explicit resource-limit error. The API does not promise preemptive parser-depth isolation.

All quantity fields use `bigint`. Output indices are restricted to `0..65535`. Hex inputs are validated for required lengths; decoders return lowercase hex. Constructor alternatives cover the ledger Word64 range: `constr()` preserves safe alternatives as numbers and larger alternatives as bigint. JSON preserves the former numeric shape and uses exact decimal strings for larger constructor alternatives; opaque recipient data additionally restricts tags to `0..127`, depth to 16, nodes to 256, signed integers to 256 bits, and normalized bytes to 1024. Maps preserve pair order and opaque maps reject duplicate Data-equal keys.

`requestRecoveryFromCbor(raw, options)` validates the exact Request envelope and supported Recovery while returning `economicBodyCbor` unchanged. It uses the maintained lazy CBOR parser, so unsupported economics does not need to pass generic Data materialization or settlement decoding. `maxBytes` bounds the whole input; `maxDepth` and `maxNodes` bound each projected recovery field. The dependency still scans economic-body CBOR framing and can reject extreme recursion. A recovery projection does not authenticate an input, validate economic Data, or promise ledger feasibility. `requestRecoveryFromData` remains available for already decoded semantic Data.

`equalHex` compares validated hexadecimal byte identities without treating letter case as identity.

From `reference/`, run `npx vitest run packages/protocol` for unit and property tests. Fixtures preserve the independent Terms, State and Request vectors from the initial client. The Terms vector was compared with the pinned Aiken builtin and an independent hash implementation. Remaining generated tests exercise recursive Data roundtrips, economic monotonicity, rounding envelopes, fee accounting, deposit/redeem loss bounds and exhaustive small-market deposit limits; they do not establish whole-protocol security conformance.
