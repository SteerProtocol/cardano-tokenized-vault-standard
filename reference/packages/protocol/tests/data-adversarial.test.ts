/** Adversarial wire cases exercise rejection boundaries beyond encoder/decoder round trips. */
import { describe, expect, test } from "vitest";
import {
  constr,
  constructorIndex,
  dataFromJson,
  dataToJson,
  decodeData,
  encodeData,
  equalData,
  hex,
  validateBoundedData,
} from "../src/index.js";
import wireVectors from "./fixtures/wire-vectors.json" with { type: "json" };

// Independent wire expectations: CTVS-1 sections 10.5-10.7 and the Plutus
// Data.hs decodeBoundedBytes/decodeConstrExtended implementation:
// https://github.com/IntersectMBO/plutus/blob/master/plutus-core/plutus-core/src/PlutusCore/Data.hs
describe("decoder rejection and semantic boundaries", () => {
  test("every proper prefix of the State fixture is incomplete", () => {
    const state = wireVectors.vectors.find((vector) => vector.name === "state");

    if (!state) throw new Error("independent State fixture missing");

    for (let end = 0; end < state.preferredCborHex.length; end += 2) {
      expect(() => decodeData(state.preferredCborHex.slice(0, end))).toThrow();
    }
  });

  test.each(["00", "d87980", "f6", "ff"])(
    "requires one complete top-level item before suffix %s",
    (suffix) => {
      for (const prefix of ["00", "80", "a0", "d87980"]) {
        expect(() => decodeData(prefix + suffix)).toThrow(/trailing/);
      }
    },
  );

  test.each(["c08100", "d8184100", "d88080", "d904ff80", "d9057980", "a100f7"])(
    "rejects unsupported tags and non-Data nested map values: %s",
    (raw) => {
      expect(() => decodeData(raw)).toThrow();
    },
  );

  test("duplicate map keys cannot hide behind alternate constructor spellings", () => {
    const decoded = decodeData("a2d879810100d8668200810101");

    expect(decoded).toEqual({
      map: [
        [constr(0, [1n]), 0n],
        [constr(0, [1n]), 1n],
      ],
    });
    expect(() => validateBoundedData(decoded)).toThrow(/duplicate/);

    // Data equality retains map order even when an entire map is used as a key.
    const orderedKeys = decodeData("a2a20001020300a20203000101");

    expect(() => validateBoundedData(orderedKeys)).not.toThrow();
  });

  test("map budgets count keys and values, and normalized byte bound includes chunk headers", () => {
    const legal = { map: Array.from({ length: 127 }, (_, i): [bigint, bigint] => [BigInt(i), 0n]) };

    expect(() => validateBoundedData(legal)).not.toThrow();
    expect(() => validateBoundedData({ map: [...legal.map, [127n, 0n]] })).toThrow(/structural/);
    expect(encodeData(new Uint8Array(990))).toHaveLength(1024);
    expect(() => validateBoundedData(new Uint8Array(990))).not.toThrow();
    expect(() => validateBoundedData(new Uint8Array(991))).toThrow(/normalized/);
  });
});

describe("constructor tag conformance", () => {
  test.each([
    { raw: "d9055f80", alternative: 102 },
    { raw: "d9057880", alternative: 127 },
    { raw: "d86682188080", alternative: 128 },
  ])("keeps constructor alternative $alternative distinct", ({ raw, alternative }) => {
    expect(decodeData(raw)).toEqual(constr(alternative));
    expect(hex(encodeData(constr(alternative)))).toBe(raw);
  });

  test("accepts indefinite extended envelopes and rejects more than two fields", () => {
    expect(decodeData("d8669f18809f01ffff")).toEqual(constr(128, [1n]));
    expect(() => decodeData("d8669f18808000ff")).toThrow(/extended/);
    expect(() => decodeData("d866822080")).toThrow(/extended/);
  });

  test("extended alternatives require a CBOR unsigned word, including for small values", () => {
    expect(() => decodeData("d86682c2410180")).toThrow(/extended|unsigned|word/i);
    expect(() => decodeData("d86682c24080")).toThrow(/extended|unsigned|word/i);
  });

  test("preserves every Word64 constructor index without rounding or changing small-number APIs", () => {
    expect(decodeData("d866821b001fffffffffffff80")).toEqual(constr(Number.MAX_SAFE_INTEGER));

    for (const [index, cbor] of [
      [1n << 53n, "d866821b002000000000000080"],
      [(1n << 53n) + 1n, "d866821b002000000000000180"],
      [(1n << 64n) - 1n, "d866821bffffffffffffffff80"],
    ] as const) {
      const data = constr(index);

      expect(data.constr).toBe(index);
      expect(decodeData(cbor)).toEqual(data);
      expect(hex(encodeData(data))).toBe(cbor);
      expect(dataToJson(data)).toEqual({ constructor: index.toString(), fields: [] });
      expect(dataFromJson(dataToJson(data))).toEqual(data);
    }

    expect(constr(0n)).toEqual(constr(0));
    expect(equalData({ constr: 0n, fields: [] }, constr(0))).toBe(true);
    expect(() => validateBoundedData({ constr: 127n, fields: [] })).not.toThrow();

    for (const index of [-1n, 1n << 64n, Number.MAX_SAFE_INTEGER + 1, 0.5, NaN])
      expect(() => constructorIndex(index)).toThrow(/constructor index/);

    for (const index of ["-1", "01", "1.5", "18446744073709551616"])
      expect(() => dataFromJson({ constructor: index, fields: [] })).toThrow();
  });
});

describe("wire byte leaves and bignums", () => {
  test.each([
    { raw: "c240", integer: 0n },
    { raw: "c340", integer: -1n },
    { raw: "c25fff", integer: 0n },
    { raw: "c35fff", integer: -1n },
    { raw: "c25f4040ff", integer: 0n },
    { raw: "c35f4040ff", integer: -1n },
  ])("accepts legal empty bignum magnitude $raw", ({ raw, integer }) => {
    // Also checked independently with CML.PlutusData.from_cbor_hex, which
    // agrees with Plutus decodeBoundedBigInteger on an empty magnitude.
    expect(decodeData(raw)).toBe(integer);
    expect(decodeData(`81${raw}`)).toEqual([integer]);
  });

  test.each(["", "c2", "c3"])(
    "rejects an oversized definite byte leaf behind tag prefix %s",
    (prefix) => {
      expect(() => decodeData(`${prefix}5841${"ab".repeat(65)}`)).toThrow(/byte|chunk/i);
    },
  );

  test.each(["c2", "c3"])("validates bignum chunks before flattening prefix %s", (prefix) => {
    expect(() => decodeData(`${prefix}5f5f4101ffff`)).toThrow(/byte|chunk/i);
    expect(() => decodeData(`${prefix}5f5841${"ab".repeat(65)}ff`)).toThrow(/byte|chunk/i);
  });

  test.each([1n << 512n, -(1n << 512n) - 1n])(
    "serializes a 65-byte integer magnitude using bounded chunks: %s",
    (integer) => {
      const prefix = integer > 0n ? "c2" : "c3";
      const expected = `${prefix}5f584001${"00".repeat(63)}4100ff`;

      expect(hex(encodeData(integer))).toBe(expected);
      expect(decodeData(expected)).toBe(integer);
    },
  );
});

describe("bounded parser behavior", () => {
  test.each(["maxBytes", "maxDepth", "maxNodes"] as const)(
    "rejects non-finite and fractional %s options",
    (option) => {
      for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0.5]) {
        expect(() => decodeData("00", { [option]: invalid })).toThrow(RangeError);
      }
    },
  );

  test("normalizes recursive parser exhaustion into an explicit resource-limit rejection", () => {
    const raw = `${"81".repeat(10_000)}00`;

    // The maintained parser recurses before the adapter's configured depth
    // walk. This proves fail-closed rejection, not pre-parse depth enforcement.
    expect(() => decodeData(raw, { maxDepth: 8 })).toThrow(RangeError);
    expect(() => decodeData(raw, { maxDepth: 8 })).toThrow(/resource limit/i);
  });
});
