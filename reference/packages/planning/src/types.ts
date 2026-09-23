/** Planner inputs and reviewable intents; these types do not represent balanced or authenticated transactions. */
import type { Address, Destination, OutRef, PlutusData, Terms } from "@ctvs/protocol";

export type ImplementationFamily = "ctvs1" | "ctvs2";
export interface ChainPoint {
  /** Cardano slot number for the supplied observation, not POSIX milliseconds. */
  slot: bigint;
  blockHash: string;
}
/** Supplied evidence binding. Planners check consistency; they do not authenticate chain history. */
interface DeploymentBase {
  network: string;
  networkDomain: string;
  policy: string;
  configLock: string;
  termsHash: string;
  configRef: OutRef;
  buildId: string;
  chainPoint: ChainPoint;
}
export interface SyncDeployment extends DeploymentBase {
  family: "ctvs1";
  claimScript: null;
}
export interface AsyncDeployment extends DeploymentBase {
  family: "ctvs2";
  claimScript: string;
}
export type Deployment = SyncDeployment | AsyncDeployment;
/** Canonical keys are "ada" or "policyHex.assetNameHex"; output custody quantities are nonnegative. */
export type Value = Record<string, bigint>;
/** Caller-supplied UTxO evidence, subject to both consistency checks and external provenance checks. */
export interface ProtectedInput {
  ref: OutRef;
  address: Address;
  /** Semantic inline Data supplied by the caller; raw recovery uses a separate datumCbor source shape. */
  datum: PlutusData;
  datumMode: "inline";
  referenceScript: null;
  /** Complete physical custody, including unrelated assets that a closed-value check may reject. */
  value: Value;
}
export interface Context {
  deployment: Deployment;
  terms: Terms;
}
export interface StateContext extends Context {
  stateInput: ProtectedInput;
}
export type FamilyContext<F extends ImplementationFamily> = Omit<Context, "deployment"> & {
  deployment: Extract<Deployment, { family: F }>;
};
export type FamilyStateContext<F extends ImplementationFamily> = FamilyContext<F> & {
  stateInput: ProtectedInput;
};
export type InputRole = "genesis_seed" | "state" | "request" | "claim";
export type OutputRole =
  | "config"
  | "state"
  | "receiver"
  | "request"
  | "claim"
  | "settler_reward"
  | "refund"
  | "delivery"
  | "fees";
export interface PlanInput {
  ref: OutRef;
  role: InputRole;
  /** Null only for the key-controlled genesis seed; script roles require their matching action envelope. */
  redeemer: PlutusData | null;
}
export interface PlannedOutput {
  role: OutputRole;
  address: Address;
  /** Null requires datumMode none; present Data requires inline mode, never a datum hash. */
  datum: PlutusData | null;
  datumMode: "none" | "inline";
  value: Value;
  referenceScript: null;
}
export interface IndexedOutput extends PlannedOutput {
  /** Protected physical output index; balancing must preserve it because redeemers reference it. */
  index: bigint;
}
export interface PlannedMint {
  policy: string;
  /** Asset-name bytes map to signed deltas: positive issuance, negative burns, no zero entries. */
  assets: Record<string, bigint>;
  redeemer: PlutusData;
}
export interface TimeBounds {
  /** Inclusive lower endpoint in POSIX milliseconds; conversion to slots happens during construction. */
  lowerPosixMs: bigint;
  /** Exclusive upper endpoint in POSIX milliseconds, strictly greater than the lower endpoint. */
  upperPosixMs: bigint;
}
export interface FiniteValidity extends TimeBounds {
  lowerInclusive: true;
  upperExclusive: true;
}
export type PlanOperation =
  | "genesis"
  | "deposit"
  | "mint"
  | "withdraw"
  | "redeem"
  | "collect_fees"
  | "top_up_reserve"
  | "set_pause"
  | "create_request"
  | "batch"
  | "cancel"
  | "expiry"
  | "deliver";
/** An intent fixes protocol effects while leaving funding, fees, collateral and signatures unresolved. */
export interface TransactionPlan {
  schema: "CTVS-REFERENCE-PLAN-1";
  kind: "transaction_intent";
  operation: PlanOperation;
  implementation: {
    family: ImplementationFamily;
    profile: 0;
    wire: 2;
    buildId: string;
    policy: string;
    configLock: string;
    claimScript: string | null;
    termsHash: string;
  };
  network: { name: string; domain: string; verifiedOnLedger: false };
  chainPoint: ChainPoint;
  inputs: PlanInput[];
  referenceInputs: OutRef[];
  outputs: IndexedOutput[];
  mint: PlannedMint[];
  requiredSigners: string[];
  validity: FiniteValidity | null;
  prohibitedPurposes: string[];
  ledgerConstruction: {
    status: "not_constructed";
    signed: false;
    submitReady: false;
    unresolved: string[];
  };
  fundingInputs: { status: "unselected" };
  change: { status: "unknown" };
  networkFee: { status: "unknown" };
  collateralExposure: { status: "unknown" };
}
export interface CreatePlan {
  operation: PlanOperation;
  deployment: Deployment;
  inputs: PlanInput[];
  referenceInputs: OutRef[];
  /** Caller order becomes the protected output index order; the plan builder does not sort it. */
  outputs: PlannedOutput[];
  mint?: PlannedMint[];
  requiredSigners?: string[];
  validity?: FiniteValidity;
}
export interface GenesisOptions extends Context {
  seed: OutRef;
  /** Externally funded positive lovelace for immutable Config custody; minimum ADA is checked later. */
  configReserve: bigint;
  /** Externally funded positive lovelace for mutable State storage, excluded from economic backing. */
  stateReserve: bigint;
}
export interface CollectFeesOptions extends StateContext {
  /** Optional external lovelace added to the fee destination output, separate from accrued fees. */
  receiverTopup?: bigint;
}
export interface TopUpOptions extends StateContext {
  /** Strictly positive external ADA added only to the State storage partition. */
  additionalLovelace: bigint;
}
export interface SetPauseOptions extends StateContext {
  /** Replacement direction mask in 0..3, not a bit toggle or a capability-mode change. */
  pauseFlags: bigint;
}
export interface Payment {
  destination: Destination;
  value: Value;
}
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
