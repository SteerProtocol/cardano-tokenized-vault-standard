/** Shared semantic types; wire codecs and arithmetic functions enforce their runtime constraints. */
/** Semantic Plutus Data preserves map pair order and exact integer values. */
export type PlutusData = bigint | Uint8Array | PlutusData[] | DataConstr | DataMap;
export interface DataConstr {
  /** Unsigned Word64 alternative; safe values may be numbers, larger alternatives must remain bigint. */
  constr: number | bigint;
  fields: PlutusData[];
}
export interface DataMap {
  /** Ordered pairs, not a JavaScript dictionary; pair order contributes to semantic Data equality. */
  map: [PlutusData, PlutusData][];
}
export type Hex = string;
export type CredentialType = "key" | "script";
export interface Credential {
  type: CredentialType;
  hash: Hex;
}
/**
 * Network-independent payment and optional inline stake credentials.
 * Pointer stake references are unsupported. Ledger adapters supply network ID when encoding
 * addresses, so credential equality alone does not establish a chosen Cardano network.
 */
export interface Address {
  payment: Credential;
  /** Null encodes an enterprise address; present values are inline key or script stake credentials. */
  stake: Credential | null;
}
export interface Destination {
  address: Address;
  /** Null means no output datum. Present Data is inline and subject to the opaque recipient-datum limits. */
  datum: PlutusData | null;
}
export type Asset = "ada" | { policy: Hex; name: Hex };
export interface OutRef {
  txId: Hex;
  /** Ledger output position as bigint in 0..65,535, not a redeemer index or a JavaScript number. */
  index: bigint;
}
export interface Terms {
  /** Only profile 0 is supported by these wire and economics helpers. */
  profile: bigint;
  /** 32-byte application network commitment; distinct from address network ID and node network magic. */
  networkDomain: Hex;
  underlying: Asset;
  /** Positive virtual SHARE units in the price denominator; these are never issued ledger tokens. */
  virtualShares: bigint;
  /** Optional cap on priced underlying backing. Null removes this cap, not the numeric quantity bound. */
  maxBacking: bigint | null;
  /** Entry fee rate in 0..9,999 basis points; quote arithmetic selects the net/gross denominator. */
  entryBps: bigint;
  /** Exit fee rate in 0..9,999 basis points; charged in underlying units, not in shares. */
  exitBps: bigint;
  feeDestination: Destination;
  /** Optional 28-byte payment key hash. Null disables pause-flag changes. */
  pauseKey: Hex | null;
  /** Null permits any settlement key; otherwise 1..16 sorted unique key hashes, never an empty list. */
  settlers: Hex[] | null;
  /**
   * Immutable capabilities: 1 immediate entry, 2 immediate exit, 4 request entry, 8 request exit.
   * Wire-valid combinations need not be supported by a compiled family or provide a viable lifecycle.
   */
  executionModes: bigint;
  /** Immutable Request-count ceiling in 1..16; transaction resources may require smaller batches. */
  maxBatch: bigint;
  /** Optional 32-byte descriptor commitment; the referenced content is not fetched or authenticated here. */
  descriptorHash: Hex | null;
}
/**
 * Mutable priced-vault accounting. Public quantities are bounded bigint base units.
 * Backing and fees use underlying-asset units, supply uses SHARE units, and storage uses lovelace.
 * The State datum is a claim about custody; planners and validators separately check physical value.
 */
export interface State {
  vaultPolicy: Hex;
  termsHash: Hex;
  /** Incremented for every State transition; Q_MAX exhaustion prevents further sequence advancement. */
  sequence: bigint;
  /** Priced underlying assets only; excludes accrued fees, storage reserve and pending deposit escrow. */
  backingAssets: bigint;
  /** Issued SHARE supply, including pending-redemption escrow and issued undelivered deposit Claims. */
  economicSupply: bigint;
  /** Underlying assets owed to feeDestination; excluded from price but still held in State custody. */
  accruedFees: bigint;
  /** Positive ADA storage partition, excluded from priced backing even when the underlying is ADA. */
  storageLovelace: bigint;
  /** Mutable directional restrictions: bit 1 pauses entry, bit 2 pauses exit; zero allows both. */
  pauseFlags: bigint;
}
export interface Config {
  vaultPolicy: Hex;
  /** One-shot genesis input used when applying the vault script parameters. */
  seed: OutRef;
  termsHash: Hex;
  terms: Terms;
  /** Positive ADA reserve held with the immutable ID token, separate from the mutable State reserve. */
  storageLovelace: bigint;
}
export interface Recovery {
  vaultPolicy: Hex;
  /** Key hash required for cancellation; naming it does not authenticate the Request creator. */
  controller: Hex;
  /** Destination for the complete source value on recovery, independent of the settlement receiver. */
  refund: Destination;
  /** Positive POSIX-millisecond deadline. Expiry requires the transaction lower bound at or after it. */
  deadlinePosixMs: bigint;
}
export type RequestKind = "deposit" | "redeem";
export interface RequestBody {
  termsHash: Hex;
  kind: RequestKind;
  /** Gross underlying units for deposit, or SHARE units to burn for redemption. */
  offered: bigint;
  /** Minimum issued SHARE for deposit, or minimum net underlying units for redemption. */
  minimumOutput: bigint;
  /** Destination for the settled Claim; may differ from the controller and recovery refund destination. */
  receiver: Destination;
  /** Positive Request storage reserve in lovelace, carried onward to the Claim. */
  storageLovelace: bigint;
  /** Additional lovelace escrow containing the settler fee; the unspent remainder follows the Claim. */
  executionBudget: bigint;
  /** Fixed lovelace reward, at most executionBudget; separate from protocol entry/exit fees. */
  settlerFee: bigint;
}
export interface Request {
  recovery: Recovery;
  body: RequestBody;
}
/** Recovery projection retains economic CBOR without decoding its semantics. */
export interface RecoveryCborProjection {
  recovery: Recovery;
  /** A copied raw CBOR child, with no economic Data interpretation or settlement eligibility implied. */
  economicBodyCbor: Uint8Array;
}
export interface RecoverableRequest {
  recovery: Recovery;
  /** Already-materialized Data retained unchanged; this projection does not validate its economic schema. */
  economicBody: PlutusData;
}
export interface Claim {
  vaultPolicy: Hex;
  /** Source Request claimed by settlement; decoding this reference does not establish lineage. */
  requestRef: OutRef;
  /** Consumed pricing State for the settlement, not the successor State output. */
  stateRef: OutRef;
  termsHash: Hex;
  asset: Asset;
  /** Positive fixed liability in asset base units: issued SHARE or net underlying, depending on settlement. */
  economicQuantity: bigint;
  receiver: Destination;
  /** Positive ADA partition accompanying the liability; physical value adds both when asset is ADA. */
  carriedLovelace: bigint;
}
export type Operation = "deposit" | "mint" | "withdraw" | "redeem";
export type Rounding = "up" | "down";
/**
 * Pure arithmetic quote at one State snapshot; it does not include network fees or ADA top-ups.
 * Asset fields use underlying base units, shares uses SHARE units, and fee is the protocol fee.
 * The amount unit depends on operation. Execution eligibility is intentionally unchecked.
 */
export interface Quote {
  operation: Operation;
  /** Deposit: gross assets; mint: shares; withdraw: net assets; redeem: shares. */
  amount: bigint;
  /** Underlying amount before extracting the protocol fee. */
  grossAssets: bigint;
  /** Underlying amount after extracting the protocol fee. */
  netAssets: bigint;
  shares: bigint;
  fee: bigint;
  /** An exact arithmetic result at this State does not establish execution eligibility. */
  pricing: "exact_at_snapshot";
  execution: "unchecked";
}
export interface TransitionResult {
  quote: Quote;
  /** New State value; the input snapshot is not mutated. */
  successor: State;
  /** Signed SHARE delta: positive issuance for entry, negative burn for exit. */
  shareMint: bigint;
}
export interface ExecutionOptions {
  /** Select request-path capability bits; profile 0 then allows only deposit and redeem. */
  asynchronous?: boolean;
}
/** Economic headroom is reportable even when ledger construction limits remain unknown. */
export type DepositLimit =
  | {
      status: "known";
      value: bigint;
      scope?: "economic_maximum";
      reason?: "sequence_exhausted";
      constructionLimit: "unknown";
    }
  | { status: "unavailable"; reason: string; constructionLimit: "unknown" };
export interface DirectAction {
  receiver: Destination;
  amount: bigint;
  /** Deposit/redeem minimum receipt, or mint/withdraw maximum input, in that operation's output/input units. */
  bound: bigint;
  stateOutput: bigint;
  receiverOutput: bigint;
}
export interface SettleEntry {
  requestRef: OutRef;
  claimOutput: bigint;
  /** Additional externally funded lovelace for this Claim, never part of economic output or settler reward. */
  claimTopup: bigint;
}
export interface BatchAction {
  stateOutput: bigint;
  entries: SettleEntry[];
  rewardKey: Hex;
  /** Null means no reward output; otherwise its index must be distinct from State and every Claim. */
  rewardOutput: bigint | null;
}
export interface DeliverEntry {
  claimRef: OutRef;
  receiverOutput: bigint;
}
export type MintAction =
  | { genesis: true; configOutput: bigint; stateOutput: bigint }
  | { genesis: false; stateRef: OutRef };
export type Role = "state" | "request" | "claim" | "mint";
export type StateRedeemer = { role: "state" } & (
  | ({ operation: Operation } & DirectAction)
  | ({ operation: "batch" } & BatchAction)
  | { operation: "collect_fees"; stateOutput: bigint; feeOutput: bigint }
  | { operation: "top_up_reserve"; amount: bigint; stateOutput: bigint }
  | { operation: "set_pause"; flags: bigint; stateOutput: bigint }
);
export type RequestRedeemer = { role: "request" } & (
  | { operation: "acknowledge"; stateRef: OutRef }
  | { operation: "cancel" | "expiry"; refundOutput: bigint }
);
export type ClaimRedeemer = { role: "claim"; operation: "deliver"; entries: DeliverEntry[] };
export type MintRedeemer = { role: "mint" } & (
  | { operation: "initialize"; genesis: true; configOutput: bigint; stateOutput: bigint }
  | { operation: "supply_update"; genesis: false; stateRef: OutRef }
);
export type DecodedRedeemer = StateRedeemer | RequestRedeemer | ClaimRedeemer | MintRedeemer;
export type DataJson =
  | { int: string }
  | { bytes: string }
  | { list: DataJson[] }
  | { map: { k: DataJson; v: DataJson }[] }
  | { constructor: number | string; fields: DataJson[] };
