/** Hex spelling must not change byte identity or relax malformed-input and authorization checks. */
import { requestValue, stateValue } from "@ctvs/planning";
import { claimFromData, requestData, stateData } from "@ctvs/protocol";
import { expect, test } from "vitest";
import { fixture, required, source } from "../../../../packages/planning/test/fixtures.js";
import * as sdk from "../src/index.js";

const policy = "ab".repeat(28),
  networkDomain = "cd".repeat(32),
  settler = "ef".repeat(28);
const validity = { lowerPosixMs: 1n, upperPosixMs: 1_999_999n };

function hexFixture() {
  const f = fixture("ctvs2", {
    terms: { networkDomain, settlers: [settler] },
    state: { vaultPolicy: policy },
  });
  const deployment = { ...f.deployment, policy, networkDomain };
  const request = { ...f.request, recovery: { ...f.request.recovery, vaultPolicy: policy } };

  return {
    ...f,
    deployment,
    request,
    stateInput: source(f.stateInput.ref, stateData(f.state), stateValue(f.state, f.terms), policy),
    requestInput: source(
      f.requestInput.ref,
      requestData(request),
      requestValue(request, f.terms),
      policy,
    ),
  };
}

test("request creation accepts differently cased policy and Terms commitments", () => {
  const f = hexFixture();
  const request = {
    ...f.request,
    recovery: { ...f.request.recovery, vaultPolicy: policy.toUpperCase() },
    body: { ...f.request.body, termsHash: f.request.body.termsHash.toUpperCase() },
  };
  const plan = sdk.buildRequestPlan({ ...f, request });

  expect(plan.outputs[0]?.value).toEqual(f.requestInput.value);
  expect(plan.outputs[0]?.datum).toEqual(requestData(f.request));
});

test.each([false, true])(
  "batch settlement authorizes equivalent settler bytes, uppercase Terms key: %s",
  (uppercaseTerms) => {
    const f = hexFixture();
    const plan = sdk.buildBatchPlan({
      ...f,
      terms: { ...f.terms, settlers: [uppercaseTerms ? settler.toUpperCase() : settler] },
      deployment: {
        ...f.deployment,
        policy: policy.toUpperCase(),
        networkDomain: networkDomain.toUpperCase(),
        termsHash: f.deployment.termsHash.toUpperCase(),
      },
      requests: [{ input: f.requestInput }],
      rewardKey: uppercaseTerms ? settler : settler.toUpperCase(),
      validity,
    });
    const claim = claimFromData(required(plan.outputs[1]?.datum));

    expect(claim.vaultPolicy).toBe(policy);
    expect(claim.termsHash).toBe(f.deployment.termsHash);
    expect(claim.economicQuantity).toBe(100_000n);
  },
);

test("settler byte comparison still rejects a different key and malformed hex", () => {
  const f = hexFixture();

  for (const rewardKey of ["de".repeat(28), "gg".repeat(28), "e".repeat(55)]) {
    expect(() =>
      sdk.buildBatchPlan({
        ...f,
        requests: [{ input: f.requestInput }],
        rewardKey,
        validity,
      }),
    ).toThrow();
  }
});

test.each(["cancel", "expiry"] as const)(
  "%s recovery matches policy bytes across hex casing",
  (mode) => {
    const f = hexFixture();
    const plan = sdk.buildRefundPlan({
      deployment: { ...f.deployment, policy: policy.toUpperCase() },
      source: f.requestInput,
      mode,
      validity: { lowerPosixMs: 2_000_000n, upperPosixMs: 3_000_000n },
    });

    expect(plan.outputs[0]?.value).toEqual(f.requestInput.value);
  },
);

test("request identity comparisons still reject malformed and foreign commitments", () => {
  const f = hexFixture();

  for (const vaultPolicy of ["gg".repeat(28), "a".repeat(55), "ff".repeat(28)]) {
    expect(() =>
      sdk.buildRequestPlan({
        ...f,
        request: { ...f.request, recovery: { ...f.request.recovery, vaultPolicy } },
      }),
    ).toThrow();
  }

  for (const termsHash of ["gg".repeat(32), "a".repeat(63), "ff".repeat(32)]) {
    expect(() =>
      sdk.buildRequestPlan({
        ...f,
        request: { ...f.request, body: { ...f.request.body, termsHash } },
      }),
    ).toThrow();
  }
});
