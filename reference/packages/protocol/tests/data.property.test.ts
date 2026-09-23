/** Generated recursive Data checks lossless CBOR and JSON transport across every semantic variant. */
import fc from "fast-check";
import { expect, it } from "vitest";
import type { PlutusData } from "../src/index.js";
import {
  constr,
  dataFromJson,
  dataToJson,
  decodeData,
  encodeData,
  equalData,
} from "../src/index.js";

const leaf: fc.Arbitrary<PlutusData> = fc.oneof(
  fc.bigInt({ min: -(1n << 255n), max: (1n << 255n) - 1n }),
  fc.uint8Array({ maxLength: 150 }),
);

function arbitraryData(depth: number): fc.Arbitrary<PlutusData> {
  if (depth === 0) return leaf;

  const child = arbitraryData(depth - 1);

  return fc.oneof(
    leaf,
    fc.array(child, { maxLength: 4 }),
    fc
      .tuple(fc.bigInt({ min: 0n, max: (1n << 64n) - 1n }), fc.array(child, { maxLength: 4 }))
      .map(([tag, fields]) => constr(tag, fields)),
    fc.array(fc.tuple(child, child), { maxLength: 4 }).map((map) => ({ map })),
  );
}

it("roundtrips varied recursive Data through maintained CBOR and exact JSON", () => {
  fc.assert(
    fc.property(arbitraryData(3), (data) => {
      expect(equalData(decodeData(encodeData(data)), data)).toBe(true);
      expect(equalData(dataFromJson(dataToJson(data)), data)).toBe(true);
    }),
    { numRuns: 1000 },
  );
});
