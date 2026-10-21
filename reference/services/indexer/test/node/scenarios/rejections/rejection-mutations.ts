/** Small explicit mutations preserve balances while changing a single protected obligation. */
import assert from "node:assert/strict";
import type { TransactionPlan } from "@ctvs/planning";
import { isConstr, type Role } from "@ctvs/protocol";

export function action(plan: TransactionPlan, role: Role = "state") {
  const envelope = plan.inputs.find((input) => input.role === role)?.redeemer;

  assert.ok(envelope && isConstr(envelope));

  const value = envelope.fields[2];

  assert.ok(value && isConstr(value));

  return value;
}

export function output(plan: TransactionPlan, index: number) {
  const selected = plan.outputs[index];

  assert.ok(selected);

  return selected;
}

export function transfer(
  plan: TransactionPlan,
  from: number,
  to: number,
  asset: string,
  amount = 1n,
) {
  const source = output(plan, from).value;
  const receiver = output(plan, to).value;

  assert.ok((source[asset] ?? 0n) >= amount);
  source[asset] = (source[asset] ?? 0n) - amount;
  receiver[asset] = (receiver[asset] ?? 0n) + amount;
}

export function batchEntries(plan: TransactionPlan) {
  const entries = action(plan).fields[1];

  assert.ok(Array.isArray(entries));

  return entries;
}
