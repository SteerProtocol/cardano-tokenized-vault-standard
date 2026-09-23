# CTVS meeting working brief

**Status:** Working discussion document  
**Date:** 2026-09-02  
**Purpose:** Align Cardano ecosystem participants on what can be built now,
what must be voluntarily enabled by integrated protocols, and which future
ledger proposals are worth tracking without becoming dependencies.

## The meeting in one sentence

Build an eUTxO-native vault standard now around protected asynchronous requests,
receipts, deterministic accounting, and bounded settlement; treat atomic
multi-protocol execution as an opt-in integration capability, not as a promise
of the base standard.

## Opening position

CTVS is not asking every protocol to expose or surrender control of its state.
It defines a common vault boundary: how users express a deposit or redemption,
how their constraints are protected, how settlement is made observable, and how
wallets and indexers recognize the result.

The base standard can work today using active Cardano primitives:

- CIP-31 reference inputs for immutable configuration and readable state;
- CIP-32 inline datums for visible, deterministic request and output data;
- CIP-33 reference scripts to lower repeated witness costs where useful; and
- CIP-57 blueprints plus conformance vectors for a machine-readable interface.

Those primitives support verifiable asynchronous vault operations. They do not
by themselves make an external protocol transition atomic with a vault action.
That requires the target protocol to expose a safe, permissioned or
permissionless transition surface that a transaction builder can use.

## What we can responsibly commit to now

| Commitment | What it means | What it does not mean |
| --- | --- | --- |
| Deterministic vault accounting | Deposits, mints, withdrawals, redemptions, fees, limits, and user bounds are validated from the transaction and authenticated state. | A universal valuation model for positions held in every external protocol. |
| Async request receipts | A user can create a durable request UTxO without racing for the vault state UTxO; settlement creates a uniquely linked receipt, claim, direct payment, or refund. | Guaranteed immediate execution or a global FIFO queue. |
| Bounded batch settlement | A batcher can settle compatible requests in one authenticated state transition. | Trust in the batcher to change amount, receiver, minimum output, or reward. |
| Integration adapter path | A protocol can voluntarily specify actions, state references, value rules, and permissions needed for composable execution. | An assumption that all DEXes, lending markets, or vaults allow external state updates. |
| Future CIP alignment | Interfaces can avoid choices that would block later alignment with proposed ledger improvements. | A dependency on proposed CIPs or an implied delivery date. |

## Receipts, batchers, and atomicity

The essential distinction for the room is:

```text
Receipt / request rail
  protects user intent and makes asynchronous execution auditable

Batcher / scooper
  constructs and submits a valid transaction

Protocol transition permission
  determines whether that transaction may update an external protocol's state

Atomic composition
  exists only when every required state transition is included and accepted in
  the same valid transaction
```

A receipt is valuable even when a vault action settles asynchronously. It gives
the user a stable claim, cancellation path, minimum-output constraint, and
indexer-visible lifecycle. It does **not** convert a later DEX, lending, or
strategy interaction into an atomic operation.

## Permissioned scooper and batcher discussion

Many Cardano systems use operating roles such as scoopers, batchers, order
executors, or protocol-owned transaction builders. CTVS should not frame that
as a defect or demand that those systems become fully permissionless. The
question is whether an integration can expose a narrow, auditable permission
surface while preserving each system's safety model.

### Principle: an operator role is not a trust waiver

Even when a system appoints a primary or permissioned executor, CTVS must keep
the user's economic protection in validators and transaction templates. An
operator may choose *when* to submit a valid batch, subject to an announced
policy. It must not be able to change:

- the vault, request ID, receiver, offered amount, or minimum output;
- the declared pricing or NAV rule;
- fixed reward and refund rules;
- share mint and burn totals; or
- a request's settlement status or claim destination.

This mirrors the current async-extension trust boundary: the executor can
affect liveness and selection among valid requests, but not the protected
economic result.

### Integration models to discuss

| Model | When it fits | Required safeguards | Main trade-off |
| --- | --- | --- | --- |
| Permissionless settlement | The protocol already permits anyone to construct valid state transitions. | Deterministic request validation, bounded batches, anti-replay checks, disclosed ordering. | Competing builders and congestion need incentive design. |
| Designated executor with expiry | A protocol has an established scooper or service operator but can allow a fallback after a declared window. | Explicit service window, cancellation and/or permissionless fallback, fixed user constraints. | Better operations initially, but the expiry and outage behavior must be real. |
| Protocol-authorized adapter | An integrated protocol voluntarily approves a narrow action set or adapter. | Action allowlist, exact state and value checks, action-specific bounds, version pinning, revocation and migration rules. | Each integration is bespoke and needs security review. |
| Co-signed execution | The protocol requires its own signer, validator capability, or transaction-building service. | Clear signer role, bounded authority, non-custodial user constraints, explicit failure and timeout behavior. | Strong protocol control, less autonomous settlement. |

**Working recommendation:** standardize the evidence and protections around an
execution policy, not one universal batcher model. A conforming deployment
should disclose whether settlement is permissionless, designated for a bounded
window, protocol-authorized, or co-signed, plus the user's cancellation and
fallback rights.

### Current CTVS boundary

This is a meeting proposal, not a claim about the current implementation or a
settled CTVS feature. The present request datum does not include a
permitted-settler authority field, and the request validator remains a planning
scaffold. CTVS-2 currently describes an eligible settler and leaves liveness,
including a primary-settler outage path, as an open decision.

Therefore, a permissioned scooper or batcher must be treated as a
protocol-specific execution profile or adapter until its authority, expiry,
user reclaim path, and validator checks are separately specified, implemented,
and reviewed. It must not be implied by base-standard conformance.

## Political and ecosystem framing

The sensitive issue is control. A credible proposal recognizes that protocols
have made deliberate choices about their validators, liquidity, order flow,
and operational participants.

Use this framing:

- We are not proposing a universal controller of protocol state.
- We are not replacing established scoopers or batchers by default.
- We want each protocol to define the smallest safe action surface it is
  willing to expose.
- We standardize scoped capabilities and user protections, not whether a DAO,
  multisig, company, or individual operates an executor.
- Existing operators can be first-class integration participants, providing
  operational knowledge and a practical liveness path.
- The standard makes user constraints and integration assumptions inspectable,
  rather than hiding them in an off-chain service.
- An integration becomes a separate, reviewable adapter. It is not silently
  inherited from the base vault standard.

Avoid these claims:

- "The standard makes all Cardano DeFi atomic."
- "Receipts solve cross-protocol atomicity."
- "Permissioned batchers are trustless."
- "Every protocol must expose its state to solvers."
- "Proposed CIPs make the near-term architecture available."

## Proposed CIP posture

| CIP | Current status | Meeting use | CTVS v0 implication |
| --- | --- | --- | --- |
| CIP-118, Nested Transactions | Proposed, no listed implementers | Discuss as a future route for aggregator-completed partial transactions and broader intent handling. | No dependency. Do not promise nested or partially valid transaction flows. |
| CIP-160, Receiving Script Purpose and Addresses | Proposed, no listed implementers | Discuss as future alignment for guarding creation of UTxOs at script addresses. | Continue using authenticated state tokens, defensive datum validation, and registry patterns today. |
| CIP-183, Conflict-Based Fee Priority in Mempool | Proposed, no listed implementers | Discuss as a potential future change to how conflicting transactions compete in mempools. | Relevant to contention economics, not a vault, receipt, or atomic-composition primitive. |

The base standard must retain its current policy: only active CIPs are
normative dependencies. Proposed CIPs belong in the roadmap and ecosystem
discussion, never in conformance requirements.

## Questions for protocol teams

### Technical integration questions

1. Which UTxOs or state transitions must be consumed for a valid action?
2. Can an external builder construct that action today? If not, who may do so
   and why?
3. What narrowly scoped action would be safe to expose first: deposit, redeem,
   swap, rebalance, liquidate, claim, or another action?
4. What exact value, datum, NFT, and reference-input conditions must be held
   invariant?
5. Can the action be included with a CTVS settlement in one transaction within
   present transaction-size and execution-unit limits?
6. What may an executor choose, and what must be fixed by the user request or
   validator?
7. What happens when the primary operator is unavailable: cancellation,
   permissionless fallback, alternate authorized operator, or expiry?
8. What versioning, pause, migration, and incident-response controls are
   required for the adapter?

### Ecosystem and governance questions

1. Who owns the integration policy and security review decision?
2. How would an existing scooper or batcher participate without losing its
   operational role or creating an opaque monopoly?
3. What service-level expectations can be stated honestly, and what user
   fallback must exist when they are missed?
4. Which data should be public for wallets and indexers: executor policy,
   request state, settlement receipts, fees, and failure reasons?
5. What funding, maintenance, and incident-response commitment is needed
   before a production integration is named?

## Concrete asks for this meeting

1. Confirm that the immediate work is a vault and receipt standard, not a
   promise of universal atomic strategy loops.
2. Identify two or three candidate protocols willing to map a narrow,
   reviewable integration action.
3. For each candidate, name the existing execution role and the smallest
   acceptable permission model.
4. Agree on a liveness posture: permissionless, designated-with-expiry,
   protocol-authorized, or co-signed.
5. Select one testnet pilot that proves request creation, batch settlement,
   user protections, and an adapter boundary before discussing generalized
   solver infrastructure.

## Current project alignment and open decisions

This brief builds on the current CTVS documents:

- [CTVS-2 asynchronous extension](03-async-extension.md) defines the request,
  settlement, and claim lifecycle, including the settler trust boundary.
- [ADR 0001](adrs/0001-request-first-batched-execution.md) is a **proposed**
  shift toward request-first execution. It is not normative until accepted and
  reflected in the wire format, transaction rules, vectors, and tests.
- [Open decisions](05-open-decisions.md) still require a declared pricing,
  cancellation, fairness, reward, liveness, and claims policy before async
  implementation begins.
- [Active CIP baseline](07-cip-baseline.md) contains the normative dependency
  rule and the active primitive set.

## Suggested closing

"We can give users a safe, inspectable asynchronous vault interface now. The
next question is not whether every protocol becomes solver-compatible. It is
which narrow state transitions each protocol is willing to make safely
composable, under whose operating model, and with what user fallback. We will
build the common receipt and accounting rail first, then earn each deeper
integration through a reviewable adapter."

## Sources to have open in the room

- [CIP-31, Reference inputs](https://cips.cardano.org/cip/CIP-0031)
- [CIP-32, Inline datums](https://cips.cardano.org/cip/CIP-0032)
- [CIP-33, Reference scripts](https://cips.cardano.org/cip/CIP-0033)
- [CIP-57, Plutus Contract Blueprint](https://cips.cardano.org/cip/CIP-0057)
- [CIP-118, Nested Transactions](https://cips.cardano.org/cip/CIP-0118)
- [CIP-160, Receiving Script Purpose and Addresses](https://cips.cardano.org/cip/CIP-0160)
- [CIP-183, Conflict-Based Fee Priority in Mempool](https://cips.cardano.org/cip/CIP-0183)

## Kickoff quick sheet: TL;DR and timed agenda

**Live planning snapshot:** 2026-09-02 09:58 EDT  
**Scheduled call:** 11:00 to 11:30 EDT  
**Purpose of this section:** A short facilitator script and decision checklist.
It is designed for a 30-minute kickoff, not for resolving the entire standard.

### The one-minute version

> We are here to agree on a practical vault boundary for Cardano. The first
> version is intended to give users and integrators common, inspectable
> deposit, redemption, accounting, and receipt semantics. Its design relies on
> active ledger primitives today, but implementation and conformance work still
> remain. We are not promising that every protocol becomes atomically
> composable, or that any protocol must give up its existing scooper or
> execution model. The next step is to identify a narrow, safe integration
> action that a willing protocol can expose and test.

### Who is likely in the room

This is a Telegram-based availability snapshot, not a guarantee of attendance.
Do not assign a protocol affiliation where the working-group chat has not
verified one.

| Person or team | Attendance signal | Category supported by the group | Where to bring them in |
| --- | --- | --- | --- |
| Derek / Steer Protocol | Organizer and meeting host | Standard initiator and vault-infrastructure perspective | Facilitate opening, scope boundary, and next-step ownership. |
| Deepak / Steer Protocol | Added to the group on 2026-09-02; no RSVP in chat | Steer operating perspective | Ask for operational and pilot-delivery constraints if present. |
| EC and Indigo product developers | EC said the Wednesday morning CT slot works and planned to include one or two product developers | Indigo Labs, lending and stablecoin protocol team | Give the main protocol-integration slot: execution authority, state-transition surface, liveness, and adapter review. |
| Kylix Afonso | Said either proposed day works | Working-group participant; protocol affiliation unverified | Invite a short introduction and ask which integration or user problem matters most. |
| Eric Waisanen | Listed participant; no RSVP in the group | Ecosystem and tokenomics perspective; no protocol role verified here | If present, ask about adoption, governance, and pilot-selection criteria. |
| Quantumplation and dc | Listed participants; no RSVP or affiliation stated | Working-group participants; affiliation unverified | Ask for a concise role and protocol introduction before assigning technical asks. |
| Liqwid | The group sought a Liqwid introduction, but no named representative or RSVP appears in the chat | Target lending-protocol stakeholder, not confirmed attendee | Do not reserve decision time. Capture a follow-up owner and bring its perspective into the next session. |

**Coverage gap:** The live group confirms a lending and stablecoin perspective
through Indigo and a vault-infrastructure perspective through Steer. It does
not yet confirm an AMM or DEX, Liqwid, wallet, indexer, or dedicated
scooper-operator attendee. Keep their agenda questions visible, but do not
assume their constraints have been represented or decide their integration
model in their absence.

### 30-minute run of show

| Time | Facilitator move | Exact callout or question | Intended outcome |
| --- | --- | --- | --- |
| 11:00 to 11:02 | Open and set the boundary | Use the one-minute version above. Then say: "Today is for scope, integration constraints, and a practical next step, not for ratifying a finished standard." | Shared expectation and low-pressure discussion. |
| 11:02 to 11:05 | Fast introductions | "Name, protocol or role, the vault or integration problem you most want solved, and whether you operate or depend on a transaction executor." | Map people before making architecture claims. |
| 11:05 to 11:09 | State the problem | "Today, vault interfaces and execution flows are bespoke. We want common user protections and integration evidence without forcing a common strategy or operational model." | Agreement on the standards problem. |
| 11:09 to 11:13 | Explain the present design baseline | "The draft specifies deterministic accounting plus async requests and receipts using active Cardano primitives. The arithmetic kernel exists, but transaction validators and conformance remain to be implemented and reviewed. Receipts make asynchronous execution auditable; they do not create cross-protocol atomicity." | Separate the research baseline from a deployable product or future vision. |
| 11:13 to 11:18 | Put the execution question on the table | "Where do your existing scoopers or batchers have discretion, and what narrow state transition could an external builder safely compose with a vault settlement?" | Identify actual permission boundaries instead of debating abstractions. |
| 11:18 to 11:23 | Indigo integration roundtable | Ask Indigo: "Which action would be safest to map first? Who may construct it today? What user bounds, timeout, and fallback would be non-negotiable?" Ask the product developers for concrete UTxO, datum, validation, and operational constraints. | A candidate adapter scope or a clear reason not to pursue one yet. |
| 11:23 to 11:26 | Broaden to other participants | Ask each non-Steer participant: "What protocol or user workflow do you represent, and which one constrained action would make a useful first pilot?" | Surface additional candidates without assuming affiliations. |
| 11:26 to 11:28 | Turn discussion into decisions | "Can we agree on one pilot candidate, one execution model to investigate, and one owner for each technical fact we need to verify?" | Named owners and a bounded research plan. |
| 11:28 to 11:30 | Close cleanly | "We will publish a short decision log and an adapter questionnaire. Nothing becomes part of the base standard until its authority, liveness, user protections, and conformance tests are explicit." | Prevent accidental commitments and establish next step. |

### Questions to keep visible

1. What is the smallest safe protocol action we can integrate first?
2. Who may submit it, and which part of that permission is validator-enforced?
3. What can the executor choose, and what must remain fixed by the user?
4. What is the cancellation, expiry, or fallback route if the primary operator
   is unavailable?
5. Can the complete transition fit in one valid transaction today? If not,
   what remains asynchronous and who bears that risk?
6. Who owns the adapter specification, security review, and incident response?

### Say this, not that

| Say | Avoid |
| --- | --- |
| "We are building an interoperable vault boundary and receipt rail." | "We are standardizing every Cardano DeFi workflow." |
| "A protocol can voluntarily expose a narrow, reviewable action surface." | "Protocols need to hand their state to an external solver." |
| "A primary executor can be an operating role, subject to explicit user protections and a liveness path." | "A permissioned scooper is automatically trustless." |
| "We will track proposed CIPs for future alignment." | "The proposed CIP makes this architecture available now." |

### Status guardrails for the facilitator

- Request-first batching is a **proposed** design direction, not a settled
  conformance rule.
- The project currently validates arithmetic, not deployed transaction
  validators. Do not call it production-ready or deployable.
- `direct_custody` is only for locally checkable assets. Lending, managed NAV,
  and strategy positions need their own accounting profile.
- A permissioned-settler field, service window, and fallback are not yet CTVS
  features. Discuss them as adapter design requirements.
- Do not promise global FIFO, immediate settlement, or universal atomicity.
- Keep CIP-118, CIP-160, CIP-183, generalized solver infrastructure, and
  multi-protocol loops in the parking lot unless a specific pilot makes one
  necessary.
- The detailed async lifecycle is still open, including selection versus direct
  settlement, pricing, cancellation, fairness, rewards, liveness, and claims.

### Leave the call with these five artifacts

1. A one-sentence agreed problem statement.
2. A confirmed list of participants and protocol roles, including absent but
   relevant teams such as Liqwid.
3. One candidate pilot and its designated technical counterpart.
4. A completed first-pass adapter questionnaire covering authority, UTxOs,
   user bounds, liveness, and versioning.
5. A short decision log that records what is agreed, open, deferred, and out
   of scope.
