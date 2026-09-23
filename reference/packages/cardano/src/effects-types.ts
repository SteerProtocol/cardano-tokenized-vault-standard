/** Separates trusted wallet authorization from effects observed in candidate transaction CBOR. */
import type { Value } from "@ctvs/planning";
import type { OutRef } from "@ctvs/protocol";
import type { Script } from "@lucid-evolution/lucid";

/**
 * Output datum mode is part of authorization: none, inline Data and a datum hash
 * are not interchangeable. Inline CBOR is compared through CML canonical Data;
 * this representation is not the encoder used for CTVS Terms commitments.
 */
export type AuthorizedDatum =
  | { kind: "none" }
  | { kind: "inline"; cbor: string }
  | { kind: "hash"; hash: string };

/**
 * Value and address evidence for a referenced UTxO, obtained independently of the
 * candidate transaction. The verifier checks consistency but cannot establish
 * existence, current spendability or provenance from these fields alone.
 */
export interface ResolvedEffectInput {
  ref: OutRef;
  address: string;
  value: Value;
  /** A program present at this UTxO; it is available only if the body references the UTxO. */
  referenceScript: Script | null;
}

/**
 * Exact output content permitted by the wallet. Equality covers address bytes,
 * all nonzero asset quantities, datum mode/content and reference script content.
 * No minimum-ADA padding or unrelated asset may be silently added to this value.
 */
export interface AuthorizedOutput {
  address: string;
  value: Value;
  datum: AuthorizedDatum;
  referenceScript: Script | null;
}

/**
 * Policy fixed by the wallet before construction, using authenticated network and
 * UTxO evidence rather than values asserted by the transaction under review.
 * Allowed input lists permit selection of a subset; planInputs must exactly cover
 * planned spends. Passing review does not replace phase-one or Plutus validation.
 */
export interface WalletAuthorization {
  /** Header network ID: 0 covers test networks, whose identity needs the separate domain binding. */
  networkId: 0 | 1;
  /** Caller-supplied network identity, matched to the plan when a plan is supplied. */
  networkName: string;
  networkDomain: string;
  /** Exactly the plan's consumed UTxOs, excluding wallet funding; empty for a null plan. */
  planInputs: readonly ResolvedEffectInput[];
  /** Optional extra spends, restricted to key payment credentials. Unselected entries remain unused. */
  allowedFundingInputs: readonly ResolvedEffectInput[];
  /** May overlap consumed funding with identical address/value evidence; must be key controlled. */
  allowedCollateralInputs: readonly ResolvedEffectInput[];
  /** Selected references must not overlap actual spends or collateral; only selected entries provide scripts. */
  allowedReferenceInputs: readonly ResolvedEffectInput[];
  /** All residual outputs and collateral return use this key address/datum and no reference script. */
  change: { address: string; datum: AuthorizedDatum };
  /** Upper bound on the normal transaction fee in lovelace, not a ledger minimum-fee calculation. */
  maxNetworkFee: bigint;
  /** Upper bound on collateral ADA less collateral return; native assets must all return. */
  maxCollateralExposure: bigint;
  /** Multiset of exact extra outputs after the protected prefix; every entry must match once. */
  permittedExtraOutputs: readonly AuthorizedOutput[];
  /** Unioned with planned required signers; the body's required_signers field must equal that union. */
  additionalRequiredSigners: readonly string[];
  /** Exact body slots; null means that bound is absent. Finite plan bounds require both slots. */
  validitySlots: { lower: bigint | null; upper: bigint | null };
  /** Required when the plan carries POSIX bounds. Values come from the selected network. */
  slotConfig: { zeroTime: bigint; zeroSlot: bigint; slotLength: bigint };
}

/**
 * Trusted receipt from pre-signing review, later used to detect signing-time changes.
 * The producer freezes the wrapper and selected arrays, not this entire object graph;
 * callers must retain it as trusted state and must not reconstruct it from signed CBOR.
 * It binds reviewed effects but is not a certificate of ledger acceptance.
 */
export interface TransactionApproval {
  /** Approved CML body serialization; post-signing serialization must reproduce these bytes. */
  readonly bodyCbor: string;
  /** Hash of the approved body, also used when checking each supplied key signature. */
  readonly bodyHash: string;
  /** Canonical witness-set serialization with vkey witnesses omitted; execution units remain bound. */
  readonly nonKeyWitnessCbor: string;
  readonly fee: bigint;
  readonly collateralExposure: bigint;
  /** Selected extra spends, in observed body input order, excluding the plan's consumed inputs. */
  readonly fundingInputs: readonly string[];
  readonly collateralInputs: readonly string[];
  /** Key hashes required by spent inputs, collateral and the body's explicit signer set. */
  readonly requiredWitnesses: readonly string[];
  readonly effects: VerifiedTransactionEffects;
}

/**
 * Review data after authorization checks. Body references and output contents are
 * observed in CBOR; input values come from the supplied UTxO evidence and network
 * names/domains come from authorization. These distinctions survive a successful
 * review: neither historical provenance nor current spendability is proved here.
 */
export interface VerifiedTransactionEffects {
  networkId: 0 | 1;
  networkName: string;
  networkDomain: string;
  inputs: { ref: string; role: "plan" | "funding"; address: string; value: Value }[];
  referenceInputs: string[];
  /** Classification follows protected index first, then an unused permitted match, then change. */
  outputs: (AuthorizedOutput & { index: number; role: "protected" | "permitted" | "change" })[];
  /** Signed asset deltas from the mint field; negative values represent burns. */
  mint: Value;
  requiredSigners: string[];
  validitySlots: { lower: bigint | null; upper: bigint | null };
  collateralReturn: AuthorizedOutput | null;
  collateralInputs: { ref: string; address: string; value: Value }[];
  /** Observed pointers and budgets after matching expected Data; no script execution occurs here. */
  redeemers: {
    purpose: "spend" | "mint";
    index: bigint;
    dataCbor: string;
    memory: bigint;
    steps: bigint;
  }[];
  /**
   * Presence and approval binding are checked here; hash correctness depends on
   * ledger rules for redeemers, datums and protocol language views.
   */
  scriptDataHash: string | null;
}
