/** Keep original real-node JSON-RPC responses, distinguishing phase-two rejection from unrelated failures. */
import assert from "node:assert/strict";
import type { EvalRedeemer } from "@lucid-evolution/lucid";
import { expect } from "vitest";

export interface RpcFailure {
  code: number;
  message: string;
  data?: unknown;
}
export interface RpcReply {
  result?: unknown;
  error?: RpcFailure;
}

export function compiledFailure(response: RpcReply, purpose: "spend" | "mint" = "spend") {
  expect(response.error?.code).toBe(3010);

  const errors = response.error?.data as {
    validator: { purpose: string; index: number };
    error: RpcFailure;
  }[];

  assert.ok(Array.isArray(errors) && errors.length > 0);

  for (const row of errors) {
    expect(row.error.code).toBe(3012);
    expect(JSON.stringify(row.error.data)).not.toMatch(
      /exhaust|overspent|OutOfBudget|MachineBudgetError/i,
    );
  }

  expect(errors.some((row) => row.validator.purpose === purpose)).toBe(true);

  return errors;
}

export function evaluated(response: RpcReply): EvalRedeemer[] {
  expect(response.error).toBeUndefined();
  assert.ok(Array.isArray(response.result) && response.result.length > 0);

  const rows = response.result as {
    validator: { purpose: EvalRedeemer["redeemer_tag"]; index: number };
    budget: { memory: number; cpu: number };
  }[];

  return rows.map((row) => {
    assert.ok(
      ["spend", "mint", "publish", "withdraw", "vote", "propose"].includes(row.validator.purpose),
    );
    assert.ok(Number.isSafeInteger(row.validator.index) && row.validator.index >= 0);
    assert.ok(Number.isSafeInteger(row.budget.memory) && row.budget.memory >= 0);
    assert.ok(Number.isSafeInteger(row.budget.cpu) && row.budget.cpu >= 0);

    return {
      redeemer_tag: row.validator.purpose,
      redeemer_index: row.validator.index,
      ex_units: { mem: row.budget.memory, steps: row.budget.cpu },
    };
  });
}
