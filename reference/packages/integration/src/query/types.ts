/** Query v1 is a read transport contract, independent of the reference onchain wire version. */
import type { ChainPoint, Deployment, ProtectedInput } from "@ctvs/planning";
import type {
  Address,
  Asset,
  Claim,
  Destination,
  OutRef,
  Quote,
  Recovery,
  Request,
  Terms,
} from "@ctvs/protocol";
import type { VaultReader } from "../reader.js";
import type { Envelope, Observation } from "../types.js";

export const QUERY_VERSION = "CTVS-QUERY-1" as const;
export const QUERY_BUDGET = {
  bodyBytes: 65536,
  responseBytes: 1048576,
  subqueries: 12,
  timeoutMs: 10000,
} as const;
export const ECONOMIC_METHODS = [
  "convertToAssets",
  "convertToShares",
  "previewDeposit",
  "previewMint",
  "previewWithdraw",
  "previewRedeem",
] as const;
export type EconomicMethod = (typeof ECONOMIC_METHODS)[number];
export interface ViewBasis {
  instance: string;
  recoveryGeneration: number;
  chainPoint: ChainPoint;
  stateRef: OutRef;
}
export interface RawInput extends Omit<ProtectedInput, "datum"> {
  datumCbor: string;
}
export interface ConstructionContext {
  deployment: Deployment;
  terms: Terms;
  stateInput: RawInput;
}
export type PreviewInput = { assets: bigint; include?: readonly ["construction"] };
export type ShareInput = { shares: bigint; include?: readonly ["construction"] };
export interface ReadQueries {
  snapshot?: true;
  convertToAssets?: { shares: bigint };
  convertToShares?: { assets: bigint };
  previewDeposit?: PreviewInput;
  previewMint?: ShareInput;
  previewWithdraw?: PreviewInput;
  previewRedeem?: ShareInput;
  ownership?: { address: Address };
  context?: true;
  request?: { ref: OutRef };
  claim?: { ref: OutRef };
  recoverySource?: { ref: OutRef };
}
export type ReadRequest = {
  apiVersion: typeof QUERY_VERSION;
  queries: ReadQueries;
  expectedBasis?: ViewBasis;
};
export interface EconomicView {
  method: EconomicMethod;
  amount: bigint;
  inputUnit: "assets" | "shares";
  outputUnit: "assets" | "shares";
  units: { assets: Asset; shares: string };
  result: Observation<bigint>;
  quote: Quote | null;
  pricing: "fee_free_at_snapshot" | "exact_at_snapshot" | "indicative_until_settlement";
  availability: {
    status: "available" | "unavailable" | "unsupported" | "not_applicable";
    code: string;
  };
  capabilities: {
    read: true;
    construction: boolean;
    execution: "direct" | "request" | "unsupported" | "not_applicable";
  };
  economicMaximum: Observation<bigint>;
  constructionMaximum: Observation<bigint>;
  protocolFeeDestination: Destination;
  fees: {
    protocol: Observation<bigint>;
    network: Observation<bigint>;
    settler: Observation<bigint>;
    executionCharge: Observation<bigint>;
    storage: Observation<bigint>;
    topups: Observation<bigint>;
  };
  feeUnits: {
    protocol: Asset;
    network: "lovelace";
    settler: "lovelace";
    executionCharge: "lovelace";
    storage: "lovelace";
    topups: "lovelace";
  };
  construction?: ConstructionContext;
}
export interface RequestView {
  ref: OutRef;
  policy: string;
  recovery: Recovery;
  request: Request | null;
  created: ChainPoint;
  status: "pending_escrow" | "claimable" | "delivered" | "refunded";
  settlement: { txId: string; stateRef: OutRef; claimRef: OutRef; point: ChainPoint } | null;
  completion: { txId: string; output: OutRef; point: ChainPoint } | null;
  source: RawInput;
  unspent: boolean;
  validation: Observation<boolean>;
}
export interface ClaimView {
  ref: OutRef;
  claim: Claim;
  source: RawInput;
  unspent: boolean;
}
export interface QueryResults {
  snapshot: ReturnType<VaultReader["snapshot"]>["data"];
  convertToAssets: EconomicView;
  convertToShares: EconomicView;
  previewDeposit: EconomicView;
  previewMint: EconomicView;
  previewWithdraw: EconomicView;
  previewRedeem: EconomicView;
  ownership: ReturnType<VaultReader["ownership"]>["data"];
  context: ConstructionContext;
  request: RequestView;
  claim: ClaimView;
  recoverySource: { deployment: Deployment; source: RawInput };
}
export type QueryData<Q extends ReadQueries = ReadQueries> = {
  [K in keyof Q & keyof QueryResults]-?: QueryResults[K];
};
export type QueryResponse<Q extends ReadQueries = ReadQueries> = Envelope<QueryData<Q>> & {
  kind: "query";
  apiVersion: typeof QUERY_VERSION;
  basis: ViewBasis;
};
export type MethodResponse<K extends keyof QueryResults> = Envelope<QueryResults[K]> & {
  apiVersion: typeof QUERY_VERSION;
  basis: ViewBasis;
};
