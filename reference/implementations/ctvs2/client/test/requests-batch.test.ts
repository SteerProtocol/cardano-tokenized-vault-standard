/** Checks Request and batch intent equations, output links and failure boundaries before ledger construction. */
import { claimFromData, Q_MAX, requestData, stateFromData } from "@ctvs/protocol";
import { describe, expect, test } from "vitest";
import {
  fixture,
  key,
  makeRequest,
  otherKey,
  requestRef,
  required,
  stateRef,
} from "../../../../packages/planning/test/fixtures.js";
import * as sdk from "../src/index.js";

const validity = { lowerPosixMs: 1n, upperPosixMs: 1_999_999n };

describe("CTVS-2 family and independent requests", () => {
  test.each([4n, 8n, 12n])("initializes only declared asynchronous modes: %s", (executionModes) => {
    const f = fixture("ctvs2", { terms: { executionModes } });
    const plan = sdk.buildGenesisPlan({
      ...f,
      seed: stateRef,
      configReserve: 2_000_000n,
      stateReserve: 3_000_000n,
    });

    expect(plan.implementation.family).toBe("ctvs2");
    expect(plan.implementation.claimScript).toBe(f.deployment.claimScript);
    expect(stateFromData(required(plan.outputs[1]?.datum)).economicSupply).toBe(0n);
    expect(Object.keys(sdk)).not.toContain("buildDirectPlan");
  });
  test("port: creation records a funded candidate without State spend or self-reference", () => {
    const f = fixture("ctvs2"),
      plan = sdk.buildRequestPlan(f);

    expect(plan.inputs).toEqual([]);
    expect(plan.mint).toEqual([]);
    expect(plan.requestId.status).toBe("unknown_until_transaction_exists");
    expect(plan.outputs[0]?.value).toEqual(f.requestInput.value);
    expect(plan.attribution).toBe("candidate_creation_does_not_authenticate_named_controller");
    expect(plan.participation).toBe("pending_assets_excluded_from_backing");

    const request = makeRequest(f, { kind: "redeem", offered: 10n, minimumOutput: 1n }).request;

    expect(sdk.buildRequestPlan({ ...f, request }).participation).toBe(
      "escrowed_shares_still_participate",
    );
  });
  test("creation rejects unsupported direction, deployment terms and foreign policy", () => {
    const f = fixture("ctvs2", { terms: { executionModes: 4n } });

    expect(() =>
      sdk.buildRequestPlan({
        ...f,
        request: makeRequest(f, { kind: "redeem", offered: 10n, minimumOutput: 1n }).request,
      }),
    ).toThrow(/direction/);
    expect(() =>
      sdk.buildRequestPlan({
        ...f,
        request: { ...f.request, recovery: { ...f.request.recovery, vaultPolicy: otherKey } },
      }),
    ).toThrow(/mismatch/);
    expect(() =>
      sdk.buildRequestPlan({
        ...f,
        request: { ...f.request, body: { ...f.request.body, termsHash: "00".repeat(32) } },
      }),
    ).toThrow(/mismatch/);
  });
});
describe("snapshot batch planning", () => {
  test("port: per-request fee, carried ADA, reward signer and both acknowledgment links", () => {
    const f = fixture("ctvs2"),
      plan = sdk.buildBatchPlan({
        ...f,
        requests: [{ input: f.requestInput, claimTopup: 50n }],
        rewardKey: key,
        validity,
      });

    expect(plan.successor.economicSupply).toBe(1_100_000n);

    const claim = claimFromData(required(plan.outputs[1]?.datum));

    expect(claim.economicQuantity).toBe(100_000n);
    expect(claim.carriedLovelace).toBe(2_200_050n);
    expect(claim.requestRef).toEqual(requestRef);
    expect(claim.stateRef).toEqual(stateRef);
    expect(plan.outputs[2]?.value.ada).toBe(100_000n);
    expect(plan.requiredSigners).toEqual([key]);
    expect(plan.inputs[1]?.redeemer).toMatchObject({ constr: 1 });
    expect(plan.pricingBasis).toEqual(stateRef);

    const topped = sdk.buildBatchPlan({
      ...f,
      requests: [{ input: f.requestInput }],
      rewardKey: key,
      validity,
      rewardTopup: 100n,
    });

    expect(topped.outputs[2]?.value.ada).toBe(100_100n);
  });
  test("port: zero-net mint retains both gross obligations and deterministic reference order", () => {
    const f = fixture("ctvs2", {
      terms: { entryBps: 0n, exitBps: 0n },
      state: { backingAssets: 1000n, economicSupply: 1000n },
    });
    const deposit = makeRequest(f, { offered: 10n, minimumOutput: 10n, settlerFee: 0n });
    const redeem = makeRequest(
      f,
      { kind: "redeem", offered: 10n, minimumOutput: 10n, settlerFee: 0n },
      { txId: "bb".repeat(32), index: 0n },
    );
    const plan = sdk.buildBatchPlan({
      ...f,
      requests: [redeem, deposit],
      rewardKey: key,
      validity,
    });

    expect(plan.mint).toEqual([]);
    expect(plan.outputs).toHaveLength(3);
    expect(plan.economicEffects.grossSharesRedeemed).toBe(10n);
    expect(plan.economicEffects.grossSharesIssued).toBe(10n);
    expect(plan.successor.backingAssets).toBe(1000n);
    expect(plan.successor.economicSupply).toBe(1000n);
    expect(plan.inputs[1]?.ref).toEqual(deposit.input.ref);
    expect(() =>
      sdk.buildBatchPlan({ ...f, requests: [deposit, deposit], rewardKey: key, validity }),
    ).toThrow(/duplicate/);
    expect(() =>
      sdk.buildBatchPlan({ ...f, requests: [deposit], rewardKey: key, validity, rewardTopup: 1n }),
    ).toThrow(/zero fee/);
  });
});

describe("snapshot batch planning", () => {
  test("deposit and redemption price against one old State, with only final-balance cap enforcement", () => {
    const f = fixture("ctvs2", {
      terms: { entryBps: 0n, exitBps: 0n, maxBacking: 18n },
      state: { backingAssets: 10n, economicSupply: 3n },
    });
    const deposit = makeRequest(f, { offered: 10n, minimumOutput: 3n, settlerFee: 0n });
    const redeem = makeRequest(
      f,
      { kind: "redeem", offered: 1n, minimumOutput: 2n, settlerFee: 0n },
      { txId: "bb".repeat(32), index: 0n },
    );
    const plan = sdk.buildBatchPlan({
      ...f,
      requests: [deposit, redeem],
      rewardKey: key,
      validity,
    });

    expect(plan.successor.backingAssets).toBe(18n);
    expect(claimFromData(required(plan.outputs[2]?.datum)).economicQuantity).toBe(2n);
    expect(() =>
      sdk.buildBatchPlan({ ...f, requests: [deposit], rewardKey: key, validity }),
    ).toThrow(/cap/);
  });
  test("port: gross issuance overflow cannot be concealed by same-transaction redemption", () => {
    const f = fixture("ctvs2", {
      terms: { entryBps: 0n, exitBps: 0n },
      state: { backingAssets: 1n, economicSupply: Q_MAX },
    });
    const requests = [
      makeRequest(f, { offered: 1n, minimumOutput: 1n, settlerFee: 0n }),
      makeRequest(
        f,
        { offered: 1n, minimumOutput: 1n, settlerFee: 0n },
        { txId: "bb".repeat(32), index: 0n },
      ),
      makeRequest(
        f,
        { kind: "redeem", offered: Q_MAX, minimumOutput: 1n, settlerFee: 0n },
        { txId: "cc".repeat(32), index: 0n },
      ),
    ];

    expect(() => sdk.buildBatchPlan({ ...f, requests, rewardKey: key, validity })).toThrow(
      /aggregate issued/,
    );
  });
  test("aggregate extinction requires pre-existing participating shares", () => {
    const f = fixture("ctvs2", {
      terms: { entryBps: 0n, exitBps: 0n },
      state: { backingAssets: 10n, economicSupply: 3n },
    });
    const requests = [
      makeRequest(f, { offered: 20n, minimumOutput: 1n, settlerFee: 0n }),
      makeRequest(
        f,
        { kind: "redeem", offered: 4n, minimumOutput: 1n, settlerFee: 0n },
        { txId: "bb".repeat(32), index: 0n },
      ),
    ];

    expect(() => sdk.buildBatchPlan({ ...f, requests, rewardKey: key, validity })).toThrow(
      /pre-existing/,
    );
  });
});

describe("snapshot batch planning", () => {
  test("eligibility rejects expired, underfunded, wrong-terms and sub-minimum requests", () => {
    const f = fixture("ctvs2"),
      args = { ...f, requests: [{ input: f.requestInput }], rewardKey: key, validity };

    expect(() =>
      sdk.buildBatchPlan({ ...args, validity: { lowerPosixMs: 1n, upperPosixMs: 2_000_001n } }),
    ).toThrow(/deadline/);
    expect(() =>
      sdk.buildBatchPlan({
        ...args,
        requests: [{ input: { ...f.requestInput, value: { ...f.requestInput.value, ada: 1n } } }],
      }),
    ).toThrow(/equation/);

    const wrongTerms = { ...f.request, body: { ...f.request.body, termsHash: "00".repeat(32) } };

    expect(() =>
      sdk.buildBatchPlan({
        ...args,
        requests: [{ input: { ...f.requestInput, datum: requestData(wrongTerms) } }],
      }),
    ).toThrow(/mismatch/);
    expect(() =>
      sdk.buildBatchPlan({ ...args, requests: [makeRequest(f, { minimumOutput: 100_001n })] }),
    ).toThrow(/minimum/);
    expect(() =>
      sdk.buildBatchPlan({
        ...args,
        requests: [makeRequest(f, { offered: 1n, minimumOutput: 1n })],
      }),
    ).toThrow();
  });
  test("settler authority, batch count and paused direction are independently enforced", () => {
    const f = fixture("ctvs2"),
      args = { ...f, requests: [{ input: f.requestInput }], rewardKey: key, validity };
    const permissioned = fixture("ctvs2", { terms: { settlers: [otherKey] } });

    expect(() =>
      sdk.buildBatchPlan({
        ...args,
        ...permissioned,
        requests: [{ input: permissioned.requestInput }],
      }),
    ).toThrow(/unauthorized/);

    const bounded = fixture("ctvs2", { terms: { maxBatch: 1n } });

    expect(() =>
      sdk.buildBatchPlan({
        ...args,
        ...bounded,
        requests: [
          makeRequest(bounded),
          makeRequest(bounded, {}, { txId: "bb".repeat(32), index: 0n }),
        ],
      }),
    ).toThrow(/maxBatch/);

    const paused = fixture("ctvs2", { state: { pauseFlags: 1n } });

    expect(() =>
      sdk.buildBatchPlan({ ...args, ...paused, requests: [{ input: paused.requestInput }] }),
    ).toThrow(/paused/);
    expect(() => sdk.buildBatchPlan({ ...args, requests: [] })).toThrow();
  });
});
