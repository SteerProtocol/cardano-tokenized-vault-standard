/** Actual native direct-operation forks restore exact fees, supply, custody and ownership. */
import type { Address } from "@ctvs/protocol";
import { expect, it } from "vitest";
import fixture from "../fixtures/accepted/ctvs1-native-real-rollback.json" with { type: "json" };
import {
  apply,
  backward,
  custody,
  type Event,
  projection,
  state,
  wire,
} from "./native-rollback-fixture.js";

const { policy, underlying, owner } = fixture.expected;

it.each(fixture.expected.branches)(
  "reverses native $step.operation from its actual accepted branch",
  (branch) => {
    const reader = projection(fixture);
    const name = branch.step.operation as "deposit" | "mint" | "withdraw" | "redeem";
    let reversals = 0;

    for (const event of fixture.sessions[name] as Event[]) {
      if (backward(event)) {
        state(reader, policy, branch.afterState);
        expect(reader.context(policy).stateInput.ref.txId).toBe(branch.txId);
        apply(reader, event);
        state(reader, policy, branch.beforeState);
        expect(reader.context(policy).stateInput.ref).toEqual({
          ...branch.beforeInput.ref,
          index: BigInt(branch.beforeInput.ref.index),
        });
        expect(reader.ownership(policy, owner as Address).data.freeShares).toBe(
          BigInt(branch.beforeState.economicSupply),
        );
        custody(reader, policy, underlying);
        reversals++;
      } else apply(reader, event);
    }

    expect(reversals).toBe(1);
    state(reader, policy, branch.beforeState);
  },
);

it("applies only the replacement native deposit after the original history is orphaned", () => {
  const reader = projection(fixture);

  for (const event of fixture.sessions.replacement as Event[]) apply(reader, event);

  state(reader, policy, fixture.expected.finalState);
  custody(reader, policy, underlying);
  expect(reader.context(policy).stateInput.ref.txId).toBe(fixture.expected.replacement);
  expect(reader.ownership(policy, owner as Address).data.freeShares).toBe(50000000n);
  expect(reader.snapshot(policy).data.state.accruedFees).toBe(500000n);
});

it("matches all four native direct rollback targets to original Ogmios backward messages", () => {
  for (const name of ["deposit", "mint", "withdraw", "redeem"] as const)
    wire(fixture.sessions[name] as Event[], fixture.wire[name]);
});
