/** Economic edge cases distinguish valid snapshot arithmetic from executable state transitions. */
import { describe, expect, it } from "vitest";
import type { Operation, State, Terms } from "../src/index.js";
import {
  assertEnabled,
  ceilDiv,
  convertToAssets,
  convertToShares,
  feeRaw,
  feeTotal,
  integer,
  maxDeposit,
  positive,
  preview,
  Q_MAX,
  quantity,
  transition,
  validateEconomics,
} from "../src/index.js";
import { state, terms } from "./fixtures/example.js";

const operations: Operation[] = ["deposit", "mint", "withdraw", "redeem"];

describe("integer economics", () => {
  it("distinguishes fee charged on net from fee included in gross", () => {
    expect(feeRaw(100n, 100n)).toBe(1n);
    expect(feeTotal(101n, 100n)).toBe(1n);
    expect(feeRaw(1n, 1n)).toBe(1n);
    expect(feeTotal(0n, 9999n)).toBe(0n);
    expect(ceilDiv(0n, 3n)).toBe(0n);
    expect(ceilDiv(6n, 3n)).toBe(2n);
    expect(ceilDiv(7n, 3n)).toBe(3n);
  });
  it("bounds public quantities and excludes unsafe JavaScript numbers", () => {
    expect(quantity(Q_MAX)).toBe(Q_MAX);
    expect(integer(3n, "test", 1n, 3n)).toBe(3n);

    for (const value of [-1n, Q_MAX + 1n, 1, "1", null]) expect(() => quantity(value)).toThrow();

    expect(() => positive(0n)).toThrow();
    expect(() => ceilDiv(-1n, 2n)).toThrow();
    expect(() => ceilDiv(1n, 0n)).toThrow();
    expect(() => feeRaw(1n, 10000n)).toThrow();
    expect(() => feeTotal(-1n, 1n)).toThrow();
  });
  it("validates fee, virtual supply, cap, pause and physical custody bounds", () => {
    const invalidStates: Partial<State>[] = [
      { backingAssets: -1n },
      { economicSupply: Q_MAX + 1n },
      { storageLovelace: 0n },
      { pauseFlags: 4n },
      { backingAssets: Q_MAX, accruedFees: 1n },
    ];

    for (const invalid of invalidStates)
      expect(() => validateEconomics({ ...state, ...invalid }, terms)).toThrow();

    const invalidTerms: Partial<Terms>[] = [
      { profile: 1n },
      { virtualShares: 0n },
      { entryBps: 10000n },
      { exitBps: -1n },
      { executionModes: 0n },
      { maxBacking: state.backingAssets - 1n },
    ];

    for (const invalid of invalidTerms)
      expect(() => validateEconomics(state, { ...terms, ...invalid })).toThrow();

    expect(() =>
      validateEconomics(
        { ...state, backingAssets: Q_MAX - 3n, storageLovelace: 4n },
        { ...terms, underlying: "ada" },
      ),
    ).toThrow(/custody/);
    expect(
      validateEconomics(
        { ...state, backingAssets: Q_MAX - 4n, storageLovelace: 4n },
        { ...terms, underlying: "ada" },
      ).x,
    ).toBe(Q_MAX - 3n);
  });
});

describe("integer economics", () => {
  it("rounds conversions explicitly and leaves zero mathematical previews available", () => {
    const snapshot = { ...state, backingAssets: 2n, economicSupply: 1n };

    expect(convertToShares(snapshot, terms, 1n)).toBe(0n);
    expect(convertToShares(snapshot, terms, 1n, "up")).toBe(1n);
    expect(convertToAssets(snapshot, terms, 1n)).toBe(1n);
    expect(convertToAssets(snapshot, terms, 1n, "up")).toBe(2n);

    for (const operation of operations)
      expect(preview(operation, 0n, state, terms)).toMatchObject({
        grossAssets: 0n,
        netAssets: 0n,
        shares: 0n,
        fee: 0n,
      });
  });
  it.each(operations)("preserves exact accounting for %s", (operation) => {
    const quote = preview(operation, 10100n, state, terms);
    const bound =
      operation === "mint" ? quote.grossAssets : operation === "withdraw" ? quote.shares : 1n;
    const result = transition(operation, 10100n, bound, state, terms);
    const entry = operation === "deposit" || operation === "mint";

    expect(result.successor.backingAssets - state.backingAssets).toBe(
      entry ? quote.netAssets : -quote.grossAssets,
    );
    expect(result.successor.accruedFees - state.accruedFees).toBe(quote.fee);
    expect(result.successor.economicSupply - state.economicSupply).toBe(result.shareMint);
    expect(result.successor.sequence).toBe(state.sequence + 1n);
    expect(result.quote).toEqual(quote);

    const badBound =
      operation === "mint"
        ? quote.grossAssets - 1n
        : operation === "withdraw"
          ? quote.shares - 1n
          : operation === "deposit"
            ? quote.shares + 1n
            : quote.netAssets + 1n;

    expect(() => transition(operation, 10100n, badBound, state, terms)).toThrow(/bound/);
  });
});

describe("integer economics", () => {
  it("enforces economic execution limits separately from previews", () => {
    expect(preview("deposit", 100n, { ...state, pauseFlags: 3n }, terms).pricing).toBe(
      "exact_at_snapshot",
    );
    expect(() => transition("deposit", 1n, 1n, state, terms)).toThrow();
    expect(() => transition("redeem", state.economicSupply + 1n, 1n, state, terms)).toThrow();
    expect(() => transition("withdraw", state.backingAssets, Q_MAX, state, terms)).toThrow();
    expect(() => transition("deposit", 100n, 1n, { ...state, sequence: Q_MAX }, terms)).toThrow();
    expect(() =>
      transition("deposit", 100n, 1n, state, { ...terms, maxBacking: state.backingAssets }),
    ).toThrow();
    expect(() => transition("mint", 100n, 1000n, state, terms, { asynchronous: true })).toThrow(
      /only/,
    );
    expect(() => transition("withdraw", 100n, 1000n, state, terms, { asynchronous: true })).toThrow(
      /only/,
    );
  });
  it("checks each direct and asynchronous permission bit and both pause bits", () => {
    for (const asynchronous of [false, true])
      for (const entry of [false, true]) {
        const bit = asynchronous ? (entry ? 4n : 8n) : entry ? 1n : 2n;

        expect(() =>
          assertEnabled(state, { ...terms, executionModes: bit }, entry, asynchronous),
        ).not.toThrow();
        expect(() =>
          assertEnabled(state, { ...terms, executionModes: 15n ^ bit }, entry, asynchronous),
        ).toThrow(/disabled/);
        expect(() =>
          assertEnabled({ ...state, pauseFlags: entry ? 1n : 2n }, terms, entry, asynchronous),
        ).toThrow(/paused/);
      }

    expect(
      transition("deposit", 100n, 1n, state, terms, { asynchronous: true }).shareMint,
    ).toBeGreaterThan(0n);
    expect(
      transition("redeem", 100n, 1n, state, terms, { asynchronous: true }).shareMint,
    ).toBeLessThan(0n);
  });
});

describe("deposit resource maximum", () => {
  it("handles non-prefix positive-output validity without losing a feasible amount", () => {
    const snapshot = { ...state, backingAssets: 0n, economicSupply: 0n, storageLovelace: 1n };
    const rules = { ...terms, entryBps: 9999n, maxBacking: 1n };

    expect(() => transition("deposit", 1n, 1n, snapshot, rules)).toThrow();
    expect(transition("deposit", 2n, 1n, snapshot, rules).quote.shares).toBe(1n);
    expect(transition("deposit", 3n, 1n, snapshot, rules).quote.shares).toBe(1n);
    expect(() => transition("deposit", 4n, 1n, snapshot, rules)).toThrow();
    expect(maxDeposit(snapshot, rules)).toMatchObject({ status: "known", value: 3n });
  });
  it("reports unknown construction separately from economic exhaustion or disabled execution", () => {
    expect(maxDeposit({ ...state, pauseFlags: 1n }, terms)).toMatchObject({
      status: "unavailable",
      reason: "operation paused",
      constructionLimit: "unknown",
    });
    expect(maxDeposit(state, { ...terms, executionModes: 2n })).toMatchObject({
      status: "unavailable",
      reason: "execution mode disabled",
    });
    expect(maxDeposit({ ...state, sequence: Q_MAX }, terms)).toMatchObject({
      status: "known",
      value: 0n,
      reason: "sequence_exhausted",
    });
    expect(maxDeposit(state, { ...terms, maxBacking: state.backingAssets })).toMatchObject({
      status: "known",
      value: 0n,
    });

    const snapshot = {
      ...state,
      backingAssets: Q_MAX - 2n,
      economicSupply: 0n,
      accruedFees: 0n,
      storageLovelace: 1n,
    };

    expect(maxDeposit(snapshot, { ...terms, underlying: "ada", entryBps: 0n })).toMatchObject({
      status: "known",
      value: 0n,
    });
    expect(maxDeposit(state, terms, { asynchronous: true })).toMatchObject({
      status: "known",
      scope: "economic_maximum",
    });
  });
});
