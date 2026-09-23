/** Exercises raw refund projection with economic bodies the settlement decoder cannot safely materialize. */
import { assetId, bytes, encodeData, hex, NAMES, recoveryData } from "@ctvs/protocol";
import { expect, test } from "vitest";
import { fixture } from "../../../../packages/planning/test/fixtures.js";
import { buildRefundPlan, buildRefundPlanFromCbor, type RawRefundSource } from "../src/index.js";

function setup(body: string) {
  const f = fixture("ctvs2");
  const { datum: _datum, ...metadata } = f.requestInput;
  const datumCbor = `d87a9f444354565302${hex(encodeData(recoveryData(f.request.recovery)))}${body}ff`;
  const source: RawRefundSource = {
    ...metadata,
    value: { ...metadata.value, [`${"ef".repeat(28)}.01`]: 7n },
    datumCbor,
  };

  return {
    ...f,
    source,
    validity: { lowerPosixMs: 2_000_000n, upperPosixMs: 3_000_000n },
  };
}

test.each(["d866821b002000000000000080", `${"81".repeat(65)}00`])(
  "refunds a raw economic body without materializing it: %s",
  (body) => {
    const f = setup(body);

    for (const mode of ["cancel", "expiry"] as const) {
      const plan = buildRefundPlanFromCbor({ ...f, mode });

      expect(plan.outputs[0]?.value).toEqual(f.source.value);
      expect(plan.outputs[0]?.address).toEqual(f.request.recovery.refund.address);
      expect(plan.requiredSigners).toEqual(
        mode === "cancel" ? [f.request.recovery.controller] : [],
      );
      expect(plan.inputs[0]?.ref).toEqual(f.source.ref);
      expect(plan.referenceInputs).toEqual([]);
      expect(plan.mint).toEqual([]);
      expect(plan.ledgerConstruction.submitReady).toBe(false);
      expect(f.source.datumCbor).toBe(
        `d87a9f444354565302${hex(encodeData(recoveryData(f.request.recovery)))}${body}ff`,
      );
    }
  },
);

test("raw and decoded refund entrypoints produce the same intent for supported economics", () => {
  const f = fixture("ctvs2");
  const { datum, ...metadata } = f.requestInput;
  const options = {
    deployment: f.deployment,
    mode: "cancel" as const,
    validity: { lowerPosixMs: 1n, upperPosixMs: 2n },
  };

  expect(
    buildRefundPlanFromCbor({ ...options, source: { ...metadata, datumCbor: encodeData(datum) } }),
  ).toEqual(buildRefundPlan({ ...options, source: f.requestInput }));
});

test("raw recovery retains protected-input, deadline and byte-budget guards", () => {
  const f = setup("00");

  for (const tokenName of [NAMES.state, NAMES.id]) {
    const unit = assetId({ policy: f.deployment.policy, name: tokenName });

    expect(() =>
      buildRefundPlanFromCbor({
        ...f,
        source: { ...f.source, value: { ...f.source.value, [unit]: 1n } },
        mode: "cancel",
      }),
    ).toThrow(/protected identity/);
  }

  expect(() =>
    buildRefundPlanFromCbor({
      ...f,
      mode: "expiry",
      validity: { lowerPosixMs: 1n, upperPosixMs: 2n },
    }),
  ).toThrow(/before deadline/);
  expect(() =>
    buildRefundPlanFromCbor({ ...f, mode: "cancel", decodeOptions: { maxBytes: 1 } }),
  ).toThrow(/oversized/);
  expect(() =>
    buildRefundPlanFromCbor({
      ...f,
      mode: "cancel",
      source: { ...f.source, address: f.request.recovery.refund.address },
    }),
  ).toThrow(/wrong protected input/);
  expect(() =>
    buildRefundPlanFromCbor({
      ...f,
      mode: "cancel",
      source: { ...f.source, datumCbor: bytes("00") },
    }),
  ).toThrow(/Request/);
});
