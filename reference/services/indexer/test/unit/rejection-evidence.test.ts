/** Rejection evidence must distinguish compiled guard failures from missing inputs, timing, budgets and transport. */
import { expect, it } from "vitest";
import { compiledFailure, evaluated, type RpcReply } from "../support/evidence/rpc.js";

const failure: RpcReply = {
  error: {
    code: 3010,
    message: "scripts failed",
    data: [
      {
        validator: { purpose: "spend", index: 1 },
        error: {
          code: 3012,
          message: "validation failed",
          data: { validationError: "The machine terminated from an explicit error.", traces: [] },
        },
      },
    ],
  },
};

it("recognizes an explicit compiled validation failure at its real purpose pointer", () => {
  expect(compiledFailure(failure)[0]?.validator).toEqual({ purpose: "spend", index: 1 });
});

it.each([3101, 3117, 3118, 3150])(
  "does not count ledger error %i as compiled evaluation rejection",
  (code) => {
    expect(() =>
      compiledFailure({ error: { code, message: "different rejection boundary" } }),
    ).toThrow();
  },
);

it.each([3011, 3013, 3117])(
  "does not count evaluation context error %i as a script guard",
  (code) => {
    expect(() =>
      compiledFailure({
        error: {
          code: 3010,
          message: "context failure",
          data: [
            {
              validator: { purpose: "spend", index: 0 },
              error: { code, message: "missing script or input" },
            },
          ],
        },
      }),
    ).toThrow();
  },
);

it("refuses exhausted execution budgets and the wrong failed purpose", () => {
  const exhausted = structuredClone(failure);

  if (!exhausted.error) throw new Error("missing fixture error");

  exhausted.error.data = [
    {
      validator: { purpose: "spend", index: 1 },
      error: {
        code: 3012,
        message: "failed",
        data: { validationError: "MachineBudgetError: exhausted", traces: [] },
      },
    },
  ];
  expect(() => compiledFailure(exhausted)).toThrow();
  expect(() => compiledFailure(failure, "mint")).toThrow();
});

it("decodes raw Ogmios budgets instead of assuming installed-provider field names", () => {
  expect(
    evaluated({
      result: [
        { validator: { purpose: "spend", index: 1 }, budget: { memory: 1290145, cpu: 565123665 } },
      ],
    }),
  ).toEqual([
    { redeemer_tag: "spend", redeemer_index: 1, ex_units: { mem: 1290145, steps: 565123665 } },
  ]);
});

it.each([
  { validator: { purpose: "spend", index: 0 }, budget: { memory: 9007199254740992, cpu: 1 } },
  { validator: { purpose: "spend", index: -1 }, budget: { memory: 1, cpu: 1 } },
  { validator: { purpose: "unknown", index: 0 }, budget: { memory: 1, cpu: 1 } },
])("rejects unsafe or malformed control budget $validator", (row) => {
  expect(() => evaluated({ result: [row] })).toThrow();
});
