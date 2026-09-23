/** Contracts for trusted chain inputs, retained provenance and responses that expose their verification limits. */
import type { ChainPoint, Deployment, ProtectedInput, Value } from "@ctvs/planning";
import type { Claim, OutRef, Recovery, Request, Terms } from "@ctvs/protocol";
import type { Script, TxOutput } from "@lucid-evolution/lucid";

/**
 * Caller-pinned identity of the accepted-block source. Addresses expose networkId,
 * but cannot distinguish every test network sharing that ID; name, magic, genesis
 * and domain retain the trusted connection identity used by responses and plans.
 * The reader validates field shapes, not their correspondence to a live node.
 */
export interface NetworkBinding {
  name: string;
  networkId: 0 | 1;
  networkMagic: number;
  genesisHash: string;
  domain: string;
}
/**
 * Script artifacts reviewed and pinned by the caller, with one enabled build per family.
 * Genesis discovery reapplies the vault template to the seed and Terms hash, then
 * compares actual script identity. buildId is descriptive evidence, not a substitute
 * for those bytes. CTVS-2 requires a Claim script; CTVS-1 has no Claim execution path.
 */
export interface ReviewedBuild {
  family: "ctvs1" | "ctvs2";
  buildId: string;
  vaultTemplate: string;
  config: Script;
  claim: Script | null;
}
/**
 * Ordered raw transactions from a caller-trusted accepted block. parent identifies
 * the preceding cursor, not necessarily the preceding slot. Include phase-two-invalid
 * transactions because their collateral inputs and return still change the UTxO set.
 * Block acceptance and transaction inclusion are feed assumptions, not proved here.
 */
export interface AcceptedBlock {
  point: ChainPoint;
  parent: ChainPoint;
  /** Complete transaction CBOR hex, preserving the ledger's execution order within the block. */
  transactions: readonly string[];
}
/**
 * A decoded output with its transaction/index identity and canonical CTVS value.
 * Inherited inline datum CBOR is retained for opaque recovery; decoded data is not
 * substituted into this evidence record. The output alone supplies no vault lineage.
 */
export interface LedgerOutput extends TxOutput {
  ref: OutRef;
  value: Value;
}
/**
 * Effective changes decoded from accepted transaction CBOR, rather than every field
 * the body proposes. If valid is false, inputs/outputs represent collateral effects
 * and spends is empty. No signature, Plutus or consensus validation is performed by
 * this data shape or its decoder; the accepted feed supplies that trust context.
 */
export interface AcceptedTransaction {
  id: string;
  /** Ledger phase-two outcome flag from the supplied transaction, not a decoder verdict. */
  valid: boolean;
  inputs: OutRef[];
  /** Observed references are read-only body inputs, never removed from the projected UTxO set. */
  referenceInputs: OutRef[];
  outputs: LedgerOutput[];
  /** Canonical input identity to redeemer CBOR; Spend pointers are resolved using ledger input order. */
  spends: Map<string, string>;
}
/**
 * Genesis-authenticated vault identity plus its latest observed State successor.
 * Terms and genesis remain fixed while State and the deployment's observation point
 * advance. Reader response chainPoint may be newer than the last State transition.
 */
export interface VaultRecord {
  deployment: Deployment;
  terms: Terms;
  genesis: { txId: string; point: ChainPoint };
  state: ProtectedInput;
}
/**
 * A recognized Recovery envelope with retained creation and consumption history.
 * Recognition is distinct from supported economics and from settlement feasibility.
 * Records remain after UTxO consumption so callers can trace refund or Claim delivery;
 * the source field is historical evidence, not a guarantee that the output is unspent.
 */
export interface RequestRecord {
  ref: OutRef;
  policy: string;
  recovery: Recovery;
  /** Null means full economic decoding failed; non-null still needs Terms/value validation. */
  request: Request | null;
  /** Original observed output, including all assets and inline datum CBOR for recovery. */
  source: LedgerOutput;
  created: ChainPoint;
  /** Pending is unconsumed escrow; claimable means settled into a Claim, not yet paid to its receiver. */
  status: "pending_escrow" | "claimable" | "delivered" | "refunded";
  /** Set when State settlement creates a Claim; remains present after that Claim is delivered. */
  settlement: { txId: string; stateRef: OutRef; claimRef: OutRef; point: ChainPoint } | null;
  /** Final refund or delivery output; null while pending or merely claimable. */
  completion: { txId: string; output: OutRef; point: ChainPoint } | null;
}
/**
 * Claim authenticated through a consumed Request and the settling State action.
 * Its source is retained after delivery; delivered describes projected history and
 * can become false again after rollback. A matching datum at the script is not enough.
 */
export interface ClaimRecord {
  ref: OutRef;
  claim: Claim;
  source: LedgerOutput;
  /** Canonical identity of the originating Request record, used to update final delivery. */
  request: string;
  delivered: boolean;
}
/**
 * Mutable replay state with no pre-intersection UTxO import. Lifecycle maps retain
 * consumed records, while utxos contains currently unspent outputs seen by this feed,
 * including unrelated outputs. Build changes in a staging copy and publish atomically;
 * transactions prevents replaying the same transaction twice on the retained branch.
 */
export interface Projection {
  vaults: Map<string, VaultRecord>;
  requests: Map<string, RequestRecord>;
  claims: Map<string, ClaimRecord>;
  utxos: Map<string, LedgerOutput>;
  transactions: Set<string>;
}
/**
 * Known carries an observed/computed value under this reader's trust assumptions.
 * Unknown lacks evidence or a solver; unsupported failed the relevant profile check;
 * stale refers to an outdated view; not_applicable has no value for that lifecycle.
 * None of the latter statuses may be silently converted into zero or availability.
 */
export type Observation<T> =
  | { status: "known"; value: T }
  | { status: "unknown" | "unsupported" | "stale" | "not_applicable"; reason: string };
/**
 * Detached response plus the exact chain point and origin/build evidence it used.
 * Evidence supports audit and freshness checks, but is not a signed proof or a
 * consensus certificate. Consumers must retain the verification limits and refresh
 * stale results rather than carrying values across a rollback or State change.
 */
export interface Envelope<T> {
  schema: "CTVS-INTEGRATION-0.6";
  kind: string;
  network: NetworkBinding;
  chainPoint: ChainPoint;
  vault: { policy: string; share: string; configRef: OutRef };
  implementation: { family: "ctvs1" | "ctvs2"; buildId: string; profile: 0; wire: 2 };
  /** Describes the supported reference profile, not an independent conformance certification. */
  claimedConformance: "profile-0-reference-semantics";
  /** Retained genesis transaction, current State reference and immutable Terms commitment. */
  evidence: { genesis: string; state: OutRef; termsHash: string };
  verification: {
    disposition: "accepted_chain_and_reviewed_build";
    consensusSource: "trusted_accepted_block_feed";
    independentLedgerValidation: false;
  };
  data: T;
}
