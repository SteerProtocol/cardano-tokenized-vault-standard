/** Intent validation rejects contradictory structure while keeping ledger construction explicitly pending. */
import { constr, Q_MAX } from "@ctvs/protocol";
import { expect, test } from "vitest";
import { createGenesisPlan } from "../src/genesis.js";
import { input, output, planToJson, validatePlan } from "../src/plan.js";
import { destination, fixture, required, stateRef } from "./fixtures.js";

const genesis = () =>
  createGenesisPlan("ctvs1", {
    ...fixture("ctvs1"),
    seed: stateRef,
    configReserve: 2_000_000n,
    stateReserve: 3_000_000n,
  });

test("source/reference inputs cannot double count the same UTxO", () => {
  const p = genesis();

  expect(() => validatePlan({ ...p, inputs: [...p.inputs, ...p.inputs] })).toThrow(
    /duplicate input/,
  );
  expect(() => validatePlan({ ...p, referenceInputs: [stateRef] })).toThrow(/overlapping/);

  const ref = { ...stateRef, index: 1n };

  expect(() => validatePlan({ ...p, referenceInputs: [ref, ref] })).toThrow(/duplicate reference/);
});
test("protected datum and output index forms remain explicit", () => {
  const p = genesis(),
    first = required(p.outputs[0]);

  expect(() => validatePlan({ ...p, outputs: [{ ...first, index: 1n }] })).toThrow(/index/);
  expect(() => validatePlan({ ...p, outputs: [{ ...first, datumMode: "none" }] })).toThrow(/datum/);
  expect(output("receiver", destination, { ada: 1n }).datumMode).toBe("none");
  expect(output("receiver", { ...destination, datum: constr(123) }, { ada: 1n }).datumMode).toBe(
    "inline",
  );
  expect(input(stateRef, "state", constr(0)).redeemer).toEqual(constr(0));
});
test("script inputs carry their own role envelope and key genesis seed carries none", () => {
  const p = genesis();

  expect(() =>
    validatePlan({ ...p, inputs: [input(stateRef, "genesis_seed", constr(0))] }),
  ).toThrow(/key-controlled/);
  expect(() => validatePlan({ ...p, inputs: [input(stateRef, "state")] })).toThrow(/requires/);
});
test("mint and signer validation reject contradictory intents", () => {
  const p = genesis(),
    mint = required(p.mint[0]);

  expect(() => validatePlan({ ...p, mint: [{ ...mint, policy: "66".repeat(28) }] })).toThrow(
    /unrelated/,
  );
  expect(() => validatePlan({ ...p, mint: [{ ...mint, assets: { "4944": 0n } }] })).toThrow(
    /zero mint/,
  );
  expect(() => validatePlan({ ...p, mint: [{ ...mint, assets: { "4944": Q_MAX + 1n } }] })).toThrow(
    /mint quantity/,
  );
  expect(() => validatePlan({ ...p, requiredSigners: ["22".repeat(28), "22".repeat(28)] })).toThrow(
    /duplicate signer/,
  );
  expect(() =>
    Reflect.apply(validatePlan, undefined, [
      { ...p, ledgerConstruction: { ...p.ledgerConstruction, submitReady: true } },
    ]),
  ).toThrow(/construction boundary/);
});
test("portable JSON records exact amounts and semantic Data with candidate CBOR", () => {
  const portable = planToJson(genesis());
  const serialized = JSON.stringify(portable);

  expect(serialized).toContain('"transaction_intent"');
  expect(serialized).toContain('"plutusData"');
  expect(serialized).toContain('"cborHex"');
  expect(serialized).toContain("3000000");
  expect(() =>
    Reflect.apply(planToJson, undefined, [{ ...genesis(), invalidValue: undefined }]),
  ).toThrow(/non-JSON/);
});
