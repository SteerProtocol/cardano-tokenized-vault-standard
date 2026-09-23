/** Generated economics checks rounding, conservation and resource-search behavior against invariants. */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Operation } from "../src/index.js";
import {
  ceilDiv,
  convertToAssets,
  convertToShares,
  maxDeposit,
  preview,
  transition,
} from "../src/index.js";
import { state, terms } from "./fixtures/example.js";

const economics = fc.record({
  backing: fc.bigInt({ min: 0n, max: 1_000_000_000n }),
  supply: fc.bigInt({ min: 0n, max: 1_000_000_000n }),
  virtual: fc.bigInt({ min: 1n, max: 1_000_000n }),
  entry: fc.bigInt({ min: 0n, max: 9999n }),
  exit: fc.bigInt({ min: 0n, max: 9999n }),
});
const amount = fc.bigInt({ min: 0n, max: 1_000_000n });

describe("economic properties", () => {
  it("ceil division is the least integer that covers the numerator", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 1n << 250n }),
        fc.bigInt({ min: 1n, max: 1n << 120n }),
        (n, d) => {
          const q = ceilDiv(n, d);

          expect(q * d).toBeGreaterThanOrEqual(n);
          expect(q === 0n || (q - 1n) * d < n).toBe(true);
        },
      ),
      { numRuns: 1000 },
    );
  });
  it("floor and ceiling conversion enclose the same rational price", () => {
    fc.assert(
      fc.property(economics, amount, (e, quantity) => {
        const snapshot = { ...state, backingAssets: e.backing, economicSupply: e.supply };
        const rules = { ...terms, virtualShares: e.virtual };

        for (const convert of [convertToAssets, convertToShares]) {
          const down = convert(snapshot, rules, quantity, "down"),
            up = convert(snapshot, rules, quantity, "up");

          expect(up - down).toBeGreaterThanOrEqual(0n);
          expect(up - down).toBeLessThanOrEqual(1n);
        }

        const shares = convertToShares(snapshot, rules, quantity);

        expect(convertToAssets(snapshot, rules, shares)).toBeLessThanOrEqual(quantity);
      }),
      { numRuns: 1000 },
    );
  });
});

describe("economic properties", () => {
  it("quotes are monotonic for all operations despite integer fee rounding", () => {
    const operations: Operation[] = ["deposit", "mint", "withdraw", "redeem"];

    fc.assert(
      fc.property(economics, amount, amount, (e, a, b) => {
        const snapshot = { ...state, backingAssets: e.backing, economicSupply: e.supply };
        const rules = { ...terms, virtualShares: e.virtual, entryBps: e.entry, exitBps: e.exit };
        const lo = a < b ? a : b,
          hi = a < b ? b : a;

        for (const operation of operations) {
          const l = preview(operation, lo, snapshot, rules),
            h = preview(operation, hi, snapshot, rules);

          for (const key of ["grossAssets", "netAssets", "shares", "fee"] as const)
            expect(h[key]).toBeGreaterThanOrEqual(l[key]);
        }
      }),
      { numRuns: 1000 },
    );
  });
  it("deposit followed by redeem cannot return more assets than were paid", () => {
    fc.assert(
      fc.property(economics, amount, (e, paid) => {
        const snapshot = { ...state, backingAssets: e.backing, economicSupply: e.supply };
        const rules = { ...terms, virtualShares: e.virtual, entryBps: e.entry, exitBps: e.exit };
        const deposit = preview("deposit", paid, snapshot, rules);

        if (deposit.shares === 0n || deposit.netAssets === 0n) return;

        const entered = transition("deposit", paid, 1n, snapshot, rules);
        const redeem = preview("redeem", entered.shareMint, entered.successor, rules);

        expect(redeem.netAssets).toBeLessThanOrEqual(paid);

        if (redeem.netAssets === 0n) return;

        const exited = transition("redeem", entered.shareMint, 1n, entered.successor, rules);

        expect(exited.successor.economicSupply).toBe(snapshot.economicSupply);
        expect(exited.successor.backingAssets + exited.successor.accruedFees).toBe(
          snapshot.backingAssets + snapshot.accruedFees + paid - redeem.netAssets,
        );
      }),
      { numRuns: 2000 },
    );
  });
});

describe("economic properties", () => {
  it("binary resource search matches exhaustive valid deposits in bounded markets", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 30n }),
        fc.bigInt({ min: 0n, max: 30n }),
        fc.bigInt({ min: 1n, max: 10n }),
        fc.bigInt({ min: 0n, max: 9999n }),
        fc.bigInt({ min: 0n, max: 10n }),
        (backing, supply, virtual, fee, headroom) => {
          const snapshot = { ...state, backingAssets: backing, economicSupply: supply };
          const rules = {
            ...terms,
            virtualShares: virtual,
            entryBps: fee,
            maxBacking: backing + headroom,
          };
          let expected = 0n;

          for (let n = 1n; n <= 2n * headroom + 2n; n++) {
            try {
              transition("deposit", n, 1n, snapshot, rules);
              expected = n;
            } catch {}
          }

          const result = maxDeposit(snapshot, rules);

          expect(result.status).toBe("known");

          if (result.status === "known") expect(result.value).toBe(expected);
        },
      ),
      { numRuns: 500 },
    );
  });
});
