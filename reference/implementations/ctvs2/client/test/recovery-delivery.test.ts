/** Planner-level checks for independent recovery, complete Claim custody delivery and family-bound maintenance. */
import { claimValue } from "@ctvs/planning";
import type { Claim } from "@ctvs/protocol";
import { claimData, constr, equalData, NAMES, requestData, stateFromData } from "@ctvs/protocol";
import { expect, test } from "vitest";
import {
  destination,
  fixture,
  key,
  policy,
  requestRef,
  required,
  source,
  stateRef,
} from "../../../../packages/planning/test/fixtures.js";
import * as sdk from "../src/index.js";

test("port: unsupported economics can be canceled and all surplus property is preserved", () => {
  const f = fixture("ctvs2"),
    datum = requestData(f.request);

  datum.fields[3] = constr(999);

  const surplus = { ...f.requestInput.value, [`${"cc".repeat(28)}.00`]: 42n },
    input = { ...f.requestInput, datum, value: surplus };
  const plan = sdk.buildRefundPlan({
    deployment: f.deployment,
    source: input,
    mode: "cancel",
    validity: { lowerPosixMs: 1n, upperPosixMs: 1_999_999n },
  });

  expect(plan.outputs[0]?.value).toEqual(surplus);
  expect(plan.requiredSigners).toEqual([key]);
  expect(plan.referenceInputs).toEqual([]);
  expect(
    sdk.buildRefundPlan({
      deployment: f.deployment,
      source: input,
      mode: "cancel",
      validity: { lowerPosixMs: 2_000_000n, upperPosixMs: 3_000_000n },
    }).requiredSigners,
  ).toEqual([key]);

  const expiry = sdk.buildRefundPlan({
    deployment: f.deployment,
    source: input,
    mode: "expiry",
    validity: { lowerPosixMs: 2_000_000n, upperPosixMs: 3_000_000n },
  });

  expect(expiry.requiredSigners).toEqual([]);
  expect(expiry.mint).toEqual([]);
  expect(() =>
    sdk.buildRefundPlan({
      deployment: f.deployment,
      source: input,
      mode: "expiry",
      validity: { lowerPosixMs: 1_999_999n, upperPosixMs: 3_000_000n },
    }),
  ).toThrow(/before deadline/);
  expect(() =>
    sdk.buildRefundPlan({
      deployment: f.deployment,
      source: { ...input, value: { ...surplus, [`${policy}.${NAMES.state}`]: 1n } },
      mode: "cancel",
      validity: { lowerPosixMs: 1n, upperPosixMs: 2n },
    }),
  ).toThrow(/identity/);
  expect(() =>
    sdk.buildRefundPlan({
      deployment: { ...f.deployment, policy: "ff".repeat(28) },
      source: {
        ...input,
        address: { payment: { type: "script", hash: "ff".repeat(28) }, stake: null },
      },
      mode: "cancel",
      validity: { lowerPosixMs: 1n, upperPosixMs: 2n },
    }),
  ).toThrow(/vault mismatch/);
});
test("port: delivery exhaustively covers claims with identical lists, distinct outputs and actual surplus", () => {
  const f = fixture("ctvs2");
  const claim: Claim = {
    vaultPolicy: policy,
    requestRef,
    stateRef,
    termsHash: f.state.termsHash,
    asset: f.terms.underlying,
    economicQuantity: 10n,
    receiver: destination,
    carriedLovelace: 2_000_000n,
  };
  const actual = { ...claimValue(claim), [`${"cc".repeat(28)}.00`]: 42n };
  const claims = ["cc", "bb"].map((hash) =>
    source(
      { txId: hash.repeat(32), index: 0n },
      claimData(claim),
      actual,
      f.deployment.claimScript,
    ),
  );
  const plan = sdk.buildDeliverPlan({ deployment: f.deployment, claims });

  expect(plan.outputs).toHaveLength(2);
  expect(plan.outputs[0]?.value).toEqual(actual);
  expect(equalData(required(plan.inputs[0]?.redeemer), required(plan.inputs[1]?.redeemer))).toBe(
    true,
  );
  expect(plan.referenceInputs).toEqual([]);
  expect(plan.requiredSigners).toEqual([]);
  expect(plan.inputs[0]?.ref.txId).toBe("bb".repeat(32));
  expect(() =>
    sdk.buildDeliverPlan({
      deployment: f.deployment,
      claims: [required(claims[0]), required(claims[0])],
    }),
  ).toThrow(/duplicate/);
  expect(() =>
    sdk.buildDeliverPlan({
      deployment: f.deployment,
      claims: [source(requestRef, claimData(claim), actual)],
    }),
  ).toThrow(/address/);
});
test("CTVS-2 maintenance remains family-bound and uses common immutable accounting", () => {
  const f = fixture("ctvs2", { state: { accruedFees: 100n } });

  expect(sdk.buildCollectFeesPlan(f).outputs[1]?.value).toMatchObject({
    [`${"44".repeat(28)}.554e4954`]: 100n,
  });
  expect(
    stateFromData(
      required(sdk.buildTopUpReservePlan({ ...f, additionalLovelace: 10n }).outputs[0]?.datum),
    ).storageLovelace,
  ).toBe(3_000_010n);
  expect(sdk.buildSetPausePlan({ ...f, pauseFlags: 3n }).requiredSigners).toEqual([key]);
});
