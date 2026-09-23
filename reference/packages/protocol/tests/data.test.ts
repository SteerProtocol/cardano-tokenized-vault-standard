/** Golden bytes pin library compatibility; boundary cases keep generic Data and opaque limits distinct. */
import { describe, expect, it } from "vitest";
import {
  blake2b256,
  bytes,
  constr,
  dataFromJson,
  dataToJson,
  decodeData,
  encodeData,
  equalData,
  hex,
  validateBoundedData,
} from "../src/index.js";
import hashVectors from "./fixtures/blake2b256.json" with { type: "json" };
import wireVectors from "./fixtures/wire-vectors.json" with { type: "json" };

describe("maintained codec and hashing libraries", () => {
  it.each(hashVectors)("matches independent BLAKE2b256 vector $inputHex", (vector) => {
    expect(hex(blake2b256(bytes(vector.inputHex)))).toBe(vector.expectedHex);
  });
  it.each(wireVectors.vectors)("preserves exact protocol golden bytes for $name", (vector) => {
    const data = dataFromJson(vector.data);

    expect(hex(encodeData(data))).toBe(vector.preferredCborHex);
    expect(dataToJson(decodeData(vector.preferredCborHex))).toEqual(vector.data);
  });
  it("accepts semantically equivalent constructor array spellings", () => {
    const data = constr(0, [1n, 2n]);

    expect(hex(encodeData(data))).toBe("d8799f0102ff");
    expect(equalData(decodeData("d879820102"), data)).toBe(true);
    expect(equalData(decodeData("d8668200820102"), data)).toBe(true);
  });
  it("uses definite ordered maps rather than the library default indefinite maps", () => {
    expect(
      hex(
        encodeData({
          map: [
            [2n, 4n],
            [1n, 3n],
          ],
        }),
      ),
    ).toBe("a202040103");
    expect(
      equalData(
        {
          map: [
            [1n, 2n],
            [3n, 4n],
          ],
        },
        {
          map: [
            [3n, 4n],
            [1n, 2n],
          ],
        },
      ),
    ).toBe(false);
    expect(
      equalData(decodeData("bf02040103ff"), {
        map: [
          [2n, 4n],
          [1n, 3n],
        ],
      }),
    ).toBe(true);
  });
  it("chunks long bytes and supports extended constructors and signed bignums", () => {
    const data = constr(128, [bytes("ab".repeat(65)), -(1n << 200n), 1n << 200n]);
    const encoded = hex(encodeData(data));

    expect(encoded.startsWith("d866821880")).toBe(true);
    expect(encoded).toContain(`5f5840${"ab".repeat(64)}41abff`);
    expect(equalData(decodeData(encoded), data)).toBe(true);
  });
  it.each([
    "ff",
    "f4",
    "fa3f800000",
    "6100",
    "d87980ff",
    "d87901",
    "d8799f01",
    "d83201",
    "d866820001",
    "d8668100",
  ])("rejects non-Data or malformed CBOR %s", (raw) => {
    expect(() => decodeData(raw)).toThrow();
  });
  it("enforces outer decode budgets and byte chunks", () => {
    expect(() => decodeData("00", { maxBytes: 0 })).toThrow(/oversized/);
    expect(() => decodeData("9f9f00ffff", { maxDepth: 1 })).toThrow(/structural/);
    expect(() => decodeData("9f0001ff", { maxNodes: 2 })).toThrow(/structural/);
    expect(() => decodeData(`5f5841${"ab".repeat(65)}ff`)).toThrow(/chunk/);
    expect(() => decodeData("5f5f4100ffff")).toThrow(/chunk/);
  });
});

describe("opaque recipient Data bounds", () => {
  it("rejects duplicate equal keys while preserving pair order", () => {
    expect(() =>
      validateBoundedData({
        map: [
          [constr(0, [1n]), 2n],
          [constr(0, [1n]), 3n],
        ],
      }),
    ).toThrow(/duplicate/);
    expect(
      validateBoundedData({
        map: [
          [2n, 0n],
          [1n, 0n],
        ],
      }),
    ).toEqual({
      map: [
        [2n, 0n],
        [1n, 0n],
      ],
    });
  });
  it("enforces exact signed256 and constructor ranges", () => {
    expect(validateBoundedData(-(1n << 255n))).toBe(-(1n << 255n));
    expect(validateBoundedData((1n << 255n) - 1n)).toBe((1n << 255n) - 1n);
    expect(() => validateBoundedData(1n << 255n)).toThrow(/256/);
    expect(() => validateBoundedData(-(1n << 255n) - 1n)).toThrow(/256/);
    expect(validateBoundedData(constr(127))).toEqual(constr(127));
    expect(() => validateBoundedData(constr(128))).toThrow(/0..127/);
    expect(() => constr(-1)).toThrow(/index/);
  });
  it("counts root depth, container nodes and serialized byte overhead", () => {
    let data = constr(0);

    for (let i = 0; i < 16; i++) data = constr(0, [data]);

    expect(() => validateBoundedData(data)).not.toThrow();
    expect(() => validateBoundedData(constr(0, [data]))).toThrow(/structural/);
    expect(() => validateBoundedData(Array.from({ length: 255 }, () => 0n))).not.toThrow();
    expect(() => validateBoundedData(Array.from({ length: 256 }, () => 0n))).toThrow(/structural/);
    expect(() => validateBoundedData(bytes("00".repeat(1025)))).toThrow(/byte bound/);
    expect(() => validateBoundedData(bytes("00".repeat(1024)))).toThrow(/normalized/);
    expect(() => validateBoundedData(bytes("00".repeat(960)))).not.toThrow();
  });
});

describe("exact JSON transport and equality", () => {
  it("preserves every Data variant without coercion", () => {
    const data = constr(99, [0n, bytes("ab"), [], { map: [[1n, 2n]] }]);

    expect(dataFromJson(dataToJson(data))).toEqual(data);
    expect(equalData(1n, bytes("01"))).toBe(false);
    expect(equalData(bytes("01"), bytes("02"))).toBe(false);
    expect(equalData([1n], [])).toBe(false);
    expect(equalData([1n], { map: [] })).toBe(false);
    expect(equalData(constr(0), { map: [] })).toBe(false);
    expect(equalData(constr(0), constr(1))).toBe(false);
    expect(equalData({ map: [[0n, 1n]] }, { map: [] })).toBe(false);
  });
  it.each<unknown>([
    null,
    [],
    { int: "1.0" },
    { int: "01" },
    { int: 1 },
    { bytes: 1 },
    { list: 1 },
    { map: 1 },
    { map: [{ k: { int: "1" } }] },
    { constructor: 1 },
    { int: "1", extra: 2 },
  ])("rejects malformed JSON %j", (value) => {
    expect(() => dataFromJson(value)).toThrow();
  });
  it("rejects non-hex and unexpected byte lengths", () => {
    expect(() => bytes("a")).toThrow(/hexadecimal/);
    expect(() => bytes("gg")).toThrow(/hexadecimal/);
    expect(() => bytes("00", 28)).toThrow(/28/);
  });
});
