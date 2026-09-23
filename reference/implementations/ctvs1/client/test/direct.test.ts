/** Checks CTVS-1 intent shape and planner rejection boundaries; compiled validation lives in integration tests. */
import type { SyncDeployment } from "@ctvs/planning";
import { planToJson } from "@ctvs/planning";
import type { Operation } from "@ctvs/protocol";
import { assetId, NAMES, Q_MAX, stateFromData } from "@ctvs/protocol";
import { describe, expect, expectTypeOf, test } from "vitest";
import {
  destination,
  fixture,
  key,
  policy,
  required,
  stateRef,
} from "../../../../packages/planning/test/fixtures.js";
import * as sdk from "../src/index.js";

describe("CTVS-1 direct transaction intents", () => {
  test("port: genesis has zero supply and no async script dependency", () => {
    const f = fixture("ctvs1");
    const plan = sdk.buildGenesisPlan({
      ...f,
      seed: stateRef,
      configReserve: 2_000_000n,
      stateReserve: 3_000_000n,
    });

    expect(plan.mint[0]?.assets).toEqual({ "4944": 1n, "5354415445": 1n });
    expect(stateFromData(required(plan.outputs[1]?.datum)).economicSupply).toBe(0n);
    expect(plan.implementation.claimScript).toBeNull();
    expect(plan.implementation.family).toBe("ctvs1");
    expectTypeOf(f.deployment).toEqualTypeOf<SyncDeployment>();
    expect(Object.keys(sdk)).not.toContain("buildBatchPlan");
    expect(Object.keys(sdk)).not.toContain("buildRequestPlan");
  });
  test.each(["deposit", "mint", "withdraw", "redeem"] as const)(
    "all four operations preserve their exact signed bound: %s",
    (operation) => {
      const f = fixture("ctvs1");
      const values: Record<
        Operation,
        { amount: bigint; bound: bigint; shares: bigint; mint: bigint }
      > = {
        deposit: { amount: 101_000n, bound: 99_900n, shares: 100_000n, mint: 100_000n },
        mint: { amount: 100_000n, bound: 101_000n, shares: 100_000n, mint: 100_000n },
        withdraw: { amount: 100_000n, bound: 101_000n, shares: 101_000n, mint: -101_000n },
        redeem: { amount: 100_000n, bound: 99_000n, shares: 100_000n, mint: -100_000n },
      };
      const parameters = values[operation],
        plan = sdk.buildDirectPlan({
          ...f,
          operation,
          ...parameters,
          receiver: destination,
          receiverTopup: 2_000_000n,
        });

      expect(plan.approvedBound).toBe(parameters.bound);
      expect(plan.economicEffects.shares).toBe(parameters.shares);
      expect(plan.mint[0]?.assets[NAMES.share]).toBe(parameters.mint);
      expect(plan.inputs[0]?.redeemer).toMatchObject({ constr: 0 });
      expect(plan.mint[0]?.redeemer).toMatchObject({ constr: 3 });
      expect(plan.ledgerConstruction).toMatchObject({
        status: "not_constructed",
        signed: false,
        submitReady: false,
      });
      expect(plan.network.verifiedOnLedger).toBe(false);
      expect(JSON.stringify(planToJson(plan))).toContain(parameters.bound.toString());
    },
  );
});

describe("CTVS-1 direct transaction intents", () => {
  test("port: deposit closed value equation and share payment", () => {
    const f = fixture("ctvs1"),
      plan = sdk.buildDirectPlan({
        ...f,
        operation: "deposit",
        amount: 101_000n,
        bound: 99_900n,
        receiver: destination,
      });

    expect(plan.outputs[0]?.value[assetId(f.terms.underlying)]).toBe(1_101_000n);
    expect(plan.outputs[1]?.value[`${policy}.${NAMES.share}`]).toBe(100_000n);
    expect(() =>
      sdk.buildDirectPlan({
        ...f,
        stateInput: { ...f.stateInput, value: { ...f.stateInput.value, ada: 1n } },
        operation: "deposit",
        amount: 100n,
        bound: 1n,
        receiver: destination,
      }),
    ).toThrow(/equation/);
  });
  test("modes, pause, quote bounds and native/ADA aggregates fail closed", () => {
    const f = fixture("ctvs1");
    const args = {
      ...f,
      operation: "deposit" as const,
      amount: 101_000n,
      bound: 99_900n,
      receiver: destination,
    };

    expect(() => sdk.buildDirectPlan({ ...args, bound: 100_001n })).toThrow(/bound/);
    expect(() =>
      sdk.buildDirectPlan({ ...args, ...fixture("ctvs1", { state: { pauseFlags: 1n } }) }),
    ).toThrow(/paused/);
    expect(() =>
      sdk.buildDirectPlan({ ...args, ...fixture("ctvs1", { terms: { executionModes: 2n } }) }),
    ).toThrow(/disabled/);
    expect(() =>
      sdk.buildDirectPlan({ ...args, ...fixture("ctvs1", { terms: { executionModes: 12n } }) }),
    ).toThrow(/incompatible/);

    const ada = fixture("ctvs1", { terms: { underlying: "ada" } });
    const plan = sdk.buildDirectPlan({ ...args, ...ada });

    expect(plan.outputs[0]?.value.ada).toBe(4_101_000n);
    expect(() =>
      sdk.buildDirectPlan({
        ...args,
        ...ada,
        operation: "redeem",
        amount: 100_000n,
        bound: 99_000n,
        receiverTopup: Q_MAX,
      }),
    ).toThrow(/aggregate/);
  });
});

describe("CTVS-1 maintenance plans", () => {
  test("fee collection pays all liabilities to immutable destination and increments only sequence", () => {
    const f = fixture("ctvs1", { state: { accruedFees: 500n } });
    const plan = sdk.buildCollectFeesPlan({ ...f, receiverTopup: 2_000_000n });

    expect(stateFromData(required(plan.outputs[0]?.datum))).toEqual({
      ...f.state,
      sequence: 1n,
      accruedFees: 0n,
    });
    expect(plan.outputs[1]?.address).toEqual(destination.address);
    expect(plan.outputs[1]?.value[assetId(f.terms.underlying)]).toBe(500n);
    expect(plan.mint).toEqual([]);
    expect(plan.requiredSigners).toEqual([]);
    expect(() => sdk.buildCollectFeesPlan(fixture("ctvs1"))).toThrow(/collectible/);
  });
  test("reserve topup cannot remove storage or spend fees", () => {
    const f = fixture("ctvs1"),
      plan = sdk.buildTopUpReservePlan({ ...f, additionalLovelace: 100n });

    expect(stateFromData(required(plan.outputs[0]?.datum))).toEqual({
      ...f.state,
      sequence: 1n,
      storageLovelace: 3_000_100n,
    });
    expect(() => sdk.buildTopUpReservePlan({ ...f, additionalLovelace: 0n })).toThrow(/reserve/);
    expect(() =>
      sdk.buildTopUpReservePlan({
        ...fixture("ctvs1", { state: { sequence: Q_MAX } }),
        additionalLovelace: 1n,
      }),
    ).toThrow();
  });
  test("pause plans require explicit configured authority while maintenance remains available paused", () => {
    const f = fixture("ctvs1"),
      plan = sdk.buildSetPausePlan({ ...f, pauseFlags: 3n });

    expect(plan.requiredSigners).toEqual([key]);
    expect(stateFromData(required(plan.outputs[0]?.datum)).pauseFlags).toBe(3n);
    expect(() =>
      sdk.buildSetPausePlan({ ...fixture("ctvs1", { terms: { pauseKey: null } }), pauseFlags: 1n }),
    ).toThrow(/disabled/);
    expect(() => sdk.buildSetPausePlan({ ...f, pauseFlags: 4n })).toThrow(/pause flags/);
    expect(
      sdk.buildTopUpReservePlan({
        ...fixture("ctvs1", { state: { pauseFlags: 3n } }),
        additionalLovelace: 1n,
      }).operation,
    ).toBe("top_up_reserve");
  });
});
