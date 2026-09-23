/** Deterministic semantic fixtures, with all mode bits set to exercise codecs rather than a deployment. */
import type { Claim, Config, Destination, OutRef, Request, State, Terms } from "../../src/index.js";
import { enterprise, termsHash } from "../../src/index.js";
export const policy = "11".repeat(28),
  key = "22".repeat(28),
  networkDomain = "33".repeat(32);
export const destination: Destination = { address: enterprise(key, "key"), datum: null };
export const terms: Terms = {
  profile: 0n,
  networkDomain,
  underlying: { policy: "44".repeat(28), name: "554e4954" },
  virtualShares: 1n,
  maxBacking: null,
  entryBps: 100n,
  exitBps: 100n,
  feeDestination: destination,
  pauseKey: key,
  settlers: null,
  executionModes: 15n,
  maxBatch: 16n,
  descriptorHash: null,
};
export const state: State = {
  vaultPolicy: policy,
  termsHash: termsHash(terms),
  sequence: 0n,
  backingAssets: 1_000_000n,
  economicSupply: 1_000_000n,
  accruedFees: 0n,
  storageLovelace: 3_000_000n,
  pauseFlags: 0n,
};
export const stateRef: OutRef = { txId: "55".repeat(32), index: 0n },
  requestRef: OutRef = { txId: "aa".repeat(32), index: 0n };
export const request: Request = {
  recovery: {
    vaultPolicy: policy,
    controller: key,
    refund: destination,
    deadlinePosixMs: 2_000_000n,
  },
  body: {
    termsHash: state.termsHash,
    kind: "deposit",
    offered: 101_000n,
    minimumOutput: 99_900n,
    receiver: destination,
    storageLovelace: 2_000_000n,
    executionBudget: 300_000n,
    settlerFee: 100_000n,
  },
};
export const config: Config = {
  vaultPolicy: policy,
  seed: stateRef,
  termsHash: state.termsHash,
  terms,
  storageLovelace: 2_000_000n,
};
export const claim: Claim = {
  vaultPolicy: policy,
  requestRef,
  stateRef,
  termsHash: state.termsHash,
  asset: terms.underlying,
  economicQuantity: 100_000n,
  receiver: destination,
  carriedLovelace: 2_200_000n,
};
