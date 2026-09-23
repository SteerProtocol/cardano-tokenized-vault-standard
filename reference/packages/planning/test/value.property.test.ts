/** Generated value partitions verify exact aggregation and rejection of open or overflowing custody sums. */
import { assetId, Q_MAX } from "@ctvs/protocol";
import fc from "fast-check";
import { expect, test } from "vitest";
import { actualValue, assertSameValue, value } from "../src/value.js";
import { fixture } from "./fixtures.js";

test("partitioning one asset never changes its total, and zero entries remain absent", () => {
  const native = fixture("ctvs1").terms.underlying;

  fc.assert(
    fc.property(
      fc.bigInt({ min: 0n, max: Q_MAX / 2n }),
      fc.bigInt({ min: 0n, max: Q_MAX / 2n }),
      (a, b) => {
        const aggregated = value([
          [native, a],
          [native, b],
          ["ada", 0n],
        ]);

        expect(aggregated[assetId(native)] ?? 0n).toBe(a + b);
        expect(aggregated.ada).toBeUndefined();
        assertSameValue(aggregated, value([[native, a + b]]));
      },
    ),
    { numRuns: 300 },
  );
});
test("different actual asset amounts never satisfy a closed value equation", () => {
  fc.assert(
    fc.property(fc.bigInt({ min: 0n, max: Q_MAX - 1n }), (n) => {
      expect(() => assertSameValue(value([["ada", n]]), value([["ada", n + 1n]]))).toThrow(
        /equation/,
      );
    }),
    { numRuns: 200 },
  );
});
test("economic value rejects overflow, negative quantity and ambiguous asset identifiers", () => {
  expect(() =>
    value([
      ["ada", Q_MAX],
      ["ada", 1n],
    ]),
  ).toThrow(/aggregate/);
  expect(() => actualValue({ ada: -1n })).toThrow();
  expect(() => actualValue({ "ticker.UNIT": 1n })).toThrow(/identifier/);
  expect(() => actualValue({ [`${"11".repeat(28)}.a`]: 1n })).toThrow(/identifier/);
  expect(actualValue({ ada: 0n })).toEqual({});
});
