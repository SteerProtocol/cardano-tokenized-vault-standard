/** Internally consistent planner fixtures use synthetic identities and carry no chain-authentication claim. */
import type {
  Destination,
  OutRef,
  PlutusData,
  Request,
  RequestBody,
  State,
  Terms,
} from "@ctvs/protocol";
import { enterprise, requestData, stateData, termsHash } from "@ctvs/protocol";
import type {
  AsyncDeployment,
  Deployment,
  ImplementationFamily,
  ProtectedInput,
  SyncDeployment,
  Value,
} from "../src/types.js";
import { requestValue, stateValue } from "../src/value.js";

export function required<T>(candidate: T | null | undefined): T {
  if (candidate === null || candidate === undefined) throw new Error("required test value missing");

  return candidate;
}

export const policy = "11".repeat(28),
  key = "22".repeat(28),
  otherKey = "23".repeat(28),
  networkDomain = "33".repeat(32);
export const destination: Destination = { address: enterprise(key, "key"), datum: null };
export const stateRef: OutRef = { txId: "55".repeat(32), index: 0n };
export const requestRef: OutRef = { txId: "aa".repeat(32), index: 0n };
export interface Fixture {
  deployment: Deployment;
  terms: Terms;
  state: State;
  stateInput: ProtectedInput;
  request: Request;
  requestInput: ProtectedInput;
}
export interface SyncFixture extends Fixture {
  deployment: SyncDeployment;
}
export interface AsyncFixture extends Fixture {
  deployment: AsyncDeployment;
}
export interface FixtureOverrides {
  terms?: Partial<Terms>;
  state?: Partial<State>;
}

export function source(
  ref: OutRef,
  datum: PlutusData,
  value: Value,
  script = policy,
): ProtectedInput {
  return {
    ref,
    datum,
    value,
    address: enterprise(script),
    datumMode: "inline",
    referenceScript: null,
  };
}

export function fixture(family: "ctvs1", overrides?: FixtureOverrides): SyncFixture;
export function fixture(family: "ctvs2", overrides?: FixtureOverrides): AsyncFixture;

export function fixture(family: ImplementationFamily, overrides: FixtureOverrides = {}): Fixture {
  const terms: Terms = {
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
    executionModes: family === "ctvs1" ? 3n : 12n,
    maxBatch: 16n,
    descriptorHash: null,
    ...overrides.terms,
  };
  const state: State = {
    vaultPolicy: policy,
    termsHash: termsHash(terms),
    sequence: 0n,
    backingAssets: 1_000_000n,
    economicSupply: 1_000_000n,
    accruedFees: 0n,
    storageLovelace: 3_000_000n,
    pauseFlags: 0n,
    ...overrides.state,
  };
  const shared = {
    network: "preview",
    networkDomain,
    policy,
    configLock: "77".repeat(28),
    termsHash: state.termsHash,
    configRef: { txId: "66".repeat(32), index: 0n },
    buildId: "unit-test-fixture-not-deployed",
    chainPoint: { slot: 1n, blockHash: "99".repeat(32) },
  };
  const deployment: Deployment =
    family === "ctvs1"
      ? { ...shared, family, claimScript: null }
      : { ...shared, family, claimScript: "88".repeat(28) };
  const request: Request = {
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

  return {
    deployment,
    terms,
    state,
    stateInput: source(stateRef, stateData(state), stateValue(state, terms)),
    request,
    requestInput: source(requestRef, requestData(request), requestValue(request, terms)),
  };
}

export function makeRequest(
  f: Fixture,
  changes: Partial<RequestBody> = {},
  ref: OutRef = requestRef,
): { request: Request; input: ProtectedInput } {
  const request = { ...f.request, body: { ...f.request.body, ...changes } };

  return { request, input: source(ref, requestData(request), requestValue(request, f.terms)) };
}
