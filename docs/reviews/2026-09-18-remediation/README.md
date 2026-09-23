# Remediation of the five implementation findings

This change addresses the five findings identified by the [whitepaper conformance review](../2026-09-18-whitepaper-conformance/README.md). That review remains a historical record of its baseline. The contract families, immutable mode support, WIRE-2 hashes and profile-0 economics are unchanged. No node deployment, public-network acceptance or independent audit is claimed.

| Finding | Implemented change | Permanent evidence |
| --- | --- | --- |
| SDK recovery rejects valid unfamiliar economic bodies | Lossless Word64 constructor alternatives; maintained-library raw recovery projection; additive raw-CBOR refund planner that never decodes economics | Protocol constructor/recovery tests, client refund tests, two compiled Aiken recovery regressions |
| Equivalent settler key bytes fail hex-string comparison | Validated byte-equivalent identity comparisons across shared context and async client boundaries | Protocol/planning/client uppercase identity regressions |
| Protected-output checks miss additional wallet spending | Prior explicit wallet authorization, complete CML body/effects checks, exact body/non-key witness approval binding and required key-signature verification | Cardano package adversarial tests; signed 50-ADA extra-payment regression rejects before signing and leaves original inputs spendable |
| Structural batch/Claim caps exceed actual transaction capacity | Deterministic whole-group resource trials using complete construction and signed evaluation; fresh State for subsequent settlement; explicit exclusions | Algorithm/classifier tests and actual eight-Request/eight-Claim adaptive split integration test |
| No common authenticated integration boundary | Accepted-history reader with reviewed parameterized script identity, coherent response envelopes, discovery, quotes, lifecycle/ownership, complete effects and rollback | Reader/CML unit regressions, exact build/Terms/current-input binding tests, actual signed lifecycle replay and local competing cancellation branch |

## Cardano-specific decisions

The implementation uses existing Noble, HarmonicLabs, Lucid Evolution and CML dependencies. There is no new cryptographic primitive, CBOR byte parser, consensus implementation, database layer or generic provider framework.

- Inline datums, reference-script evidence and reference inputs follow distinct checks. Reference inputs never contribute funding or disappear from the UTxO projection.
- Redeemer pointers use canonical TxIn/policy order, not incidental CBOR array order.
- The address network ID is checked alongside an explicitly trusted network domain, magic and genesis identity. Base, enterprise and Pointer addresses are not interchangeable ownership destinations.
- POSIX-to-slot conversion must keep the authorized validity interval inside the user's bounds. Unaligned outward rounding fails.
- Collateral has a separate net-exposure ceiling and exact native-asset return. Invalid-script transactions create only their collateral return at the CIP-40 index, and cannot create ordinary State/Claim outputs. A collateral-return Request remains recoverable.
- Authenticated Claims require actual Batch allocation, consumed Request/State lineage, and exact funded value. A funded copy at Q does not create a recognized liability.
- Cancellation authority is separate from refund ownership and successful delivery entitlement. Unsupported economic data remains recoverable when the recovery envelope is valid.
- Batch resource feasibility depends on the actual transaction and current parameters. The local observed 7+1 settlement and 5+3 delivery splits are evidence, not hardcoded capacities or network promises.

## Scope and remaining acceptance work

The new reader trusts a caller-configured accepted-block feed for consensus/header/network acceptance and pins reviewed script bytes for protocol identity. It keeps an in-memory journal with deterministic rollback/replay; persistence, an operational node connector, production indexing limits and independent indexer agreement remain outside this reference module. A rollback before the retained intersection requires an earlier replay.

The common envelope implements the PDF's semantic fields, with explicit unknown/unsupported/stale/not-applicable dispositions. The unavailable historical JSON schema bundle is not claimed to be reproduced byte-for-byte. Async quotes remain indicative; constructed capacity, network fees and operation-specific maxima without an existing solver remain explicitly unknown.

The signing verifier trusts authenticated external wallet UTxO evidence and supports the stated profile's transaction shapes. Full phase-one and Plutus validation remain the evaluator/node's responsibility. The signed integration tests use the pinned local Emulator plus real signatures and explicit compiled Plutus evaluation. Their block points and rollback branch are local fixtures, not cardano-node evidence.

Hybrid modes and the proposed one-sided-mode genesis restriction in [LIMITATIONS.MD](../../../LIMITATIONS.MD) are unchanged. Those are separate configuration/lifecycle decisions, not part of these five remediations.

## Package boundaries

- [Protocol](../../../reference/packages/protocol/README.md): wire and recovery representation.
- [CTVS-2 client](../../../reference/implementations/ctvs2/client/README.md): public raw recovery planner and byte-equivalent authorization checks.
- [Cardano](../../../reference/packages/cardano/README.md): complete effects, approval binding and measured resource selection.
- [Integration](../../../reference/packages/integration/README.md): authenticated accepted-history reader and common responses.
- [Testing](../../../reference/testing/README.md): real construction, signed evaluation and retained regressions.

See [validation.json](validation.json) for the final full-gate result and environment. Existing coverage thresholds were preserved.
