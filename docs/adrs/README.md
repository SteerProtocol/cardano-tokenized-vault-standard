# Architecture decision records

These records capture proposed changes identified during the adversarial review
of the CTVS planning prototype. A record with `Proposed` status is not part of
the CTVS specification until it is explicitly accepted and the affected wire
types, transaction rules, vectors, and tests are updated.

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-request-first-batched-execution.md) | Request-first batched execution | Proposed |
| [0002](0002-reject-zero-economic-output.md) | Reject zero economic output | Proposed |
| [0003](0003-terminal-redemption-and-closure.md) | Terminal redemption and closure | Proposed |
| [0004](0004-complete-async-request-lifecycle.md) | Complete asynchronous request lifecycle | Proposed |
| [0005](0005-explicit-accounting-profiles.md) | Explicit accounting profiles | Proposed |
| [0006](0006-loss-insolvency-and-recovery.md) | Loss, insolvency, and recovery states | Proposed |
| [0007](0007-action-scoped-emergency-controls.md) | Action-scoped emergency controls | Proposed |
| [0008](0008-generalized-owner-authorization.md) | Generalized owner authorization | Proposed |
| [0009](0009-isolate-maintenance-from-user-state.md) | Isolate maintenance from user state | Proposed |
| [0010](0010-versioned-migration-protocol.md) | Versioned migration protocol | Proposed |

## Status lifecycle

- `Proposed`: under review and not normative.
- `Accepted`: approved for the named CTVS version and ready for implementation.
- `Rejected`: considered and intentionally not adopted.
- `Superseded`: replaced by a later ADR.

Changing an accepted decision requires a new ADR that supersedes the old one.
Published constructor and field ordering must never be changed in place.

## External implementation evidence

Each ADR links to related public Cardano code. These links are design
precedents, not claims that another protocol implements the proposed CTVS
decision exactly. SundaeSwap v3, Minswap v2, Lenfi, FluidTokens Lending V4,
and Indigo V1 have public contract code. Liqwid's current V2 and announced V3
on-chain implementations are not publicly linkable here, so Liqwid-specific
evidence is limited to its public liquidation bot while Lenfi and FluidTokens
provide inspectable lending-contract comparisons. Indigo links refer to its
public V1 repository and must not be represented as V2 or V3 source.
