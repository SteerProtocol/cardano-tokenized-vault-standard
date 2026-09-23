/** Exact semantic Data and JSON representations, including ordered maps and large constructors. */
import type { DataConstr, DataJson, DataMap, PlutusData } from "../types.js";

/**
 * Validate a constructor alternative in unsigned Word64 range and return it as bigint.
 * Number inputs must already be safe integers; strings and lossy coercions are rejected.
 * This bounds the alternative only, not the constructor fields or any typed datum role.
 */
export function constructorIndex(value: number | bigint): bigint {
  if (typeof value !== "bigint" && (typeof value !== "number" || !Number.isSafeInteger(value)))
    throw new RangeError("invalid constructor index");

  const index = BigInt(value);

  if (index < 0n || index > (1n << 64n) - 1n) throw new RangeError("invalid constructor index");

  return index;
}

/**
 * Construct semantic Data without encoding it or validating its fields.
 * Safe alternatives remain numbers for API compatibility; larger Word64 alternatives stay bigint.
 * The supplied fields array is retained, so this helper does not create an immutable snapshot.
 */
export function constr(tag: number | bigint, fields: PlutusData[] = []): DataConstr {
  const index = constructorIndex(tag);

  return { constr: index <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(index) : index, fields };
}

/**
 * Decode even-length hexadecimal without a prefix, accepting either letter case.
 * An optional length is an exact byte count. Malformed text and length mismatches throw.
 * Returns a new byte array; an empty string is a valid empty byte string.
 */
export function bytes(value: string, length?: number): Uint8Array {
  if (typeof value !== "string" || !/^(?:[0-9a-f]{2})*$/i.test(value))
    throw new TypeError("expected hexadecimal bytes");

  const result = Uint8Array.from(Buffer.from(value, "hex"));

  if (length !== undefined && result.length !== length)
    throw new RangeError(`expected ${length} bytes`);

  return result;
}

/**
 * Compare byte identity after strict hexadecimal validation, independent of letter case.
 * Malformed inputs throw rather than comparing unequal; this is identity normalization,
 * not a constant-time secret comparison or proof that an identifier exists on chain.
 */
export function equalHex(a: string, b: string): boolean {
  return hex(bytes(a)) === hex(bytes(b));
}

export function hex(value: Uint8Array): string {
  return Buffer.from(value).toString("hex");
}

export function isConstr(data: PlutusData): data is DataConstr {
  return (
    typeof data === "object" &&
    !(data instanceof Uint8Array) &&
    !Array.isArray(data) &&
    "constr" in data
  );
}

function equalLists(a: PlutusData[], b: PlutusData[]): boolean {
  return (
    a.length === b.length &&
    a.every((value, index) => {
      const other = b[index];

      return other !== undefined && equalData(value, other);
    })
  );
}

function equalMaps(a: DataMap, b: DataMap): boolean {
  return (
    a.map.length === b.map.length &&
    a.map.every(([k, v], i) => {
      const pair = b.map[i];

      return pair !== undefined && equalData(k, pair[0]) && equalData(v, pair[1]);
    })
  );
}

/**
 * Compare already-shaped semantic Data recursively, including list length and map pair order.
 * Numerically equal number/bigint constructor alternatives compare equal; integers stay exact.
 * No resource budget or general object validation is applied here. Use bounded decoders for
 * untrusted bytes and validateBoundedData for the restricted recipient-datum profile.
 */
export function equalData(a: PlutusData, b: PlutusData): boolean {
  if (typeof a === "bigint") return a === b;

  if (a instanceof Uint8Array) return b instanceof Uint8Array && hex(a) === hex(b);

  if (Array.isArray(a)) return Array.isArray(b) && equalLists(a, b);

  if (typeof b === "bigint" || b instanceof Uint8Array || Array.isArray(b)) return false;

  if (isConstr(a))
    return (
      isConstr(b) &&
      constructorIndex(a.constr) === constructorIndex(b.constr) &&
      equalLists(a.fields, b.fields)
    );

  return !isConstr(b) && equalMaps(a, b);
}

/**
 * Produce explicit Data JSON variants, preserving byte contents and ordered map pairs.
 * Integers use decimal strings; constructor alternatives use numbers only when safely representable.
 * This is a semantic transport representation, not commitment CBOR or a resource-budget check.
 */
export function dataToJson(data: PlutusData): DataJson {
  if (typeof data === "bigint") return { int: data.toString() };

  if (data instanceof Uint8Array) return { bytes: hex(data) };

  if (Array.isArray(data)) return { list: data.map(dataToJson) };

  if (isConstr(data)) {
    const tag = constr(data.constr).constr;

    return {
      constructor: typeof tag === "bigint" ? tag.toString() : tag,
      fields: data.fields.map(dataToJson),
    };
  }

  return { map: data.map.map(([k, v]) => ({ k: dataToJson(k), v: dataToJson(v) })) };
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("invalid Data JSON object");

  return value as Record<string, unknown>;
}

function integerFromJson(value: unknown): bigint {
  if (typeof value !== "string" || !/^-?(0|[1-9][0-9]*)$/.test(value))
    throw new TypeError("invalid decimal integer");

  return BigInt(value);
}

/**
 * Read an ordered array of explicit key/value pairs, recursively rebuilding each Data variant.
 * Do not collapse repeated keys into a dictionary or reorder pairs: unrestricted Plutus Data
 * retains both. Duplicate-key rejection belongs to the narrower opaque-datum profile.
 */
function mapFromJson(value: unknown): DataMap {
  if (!Array.isArray(value)) throw new TypeError("invalid JSON map");

  return {
    map: value.map((pair) => {
      const entry = object(pair);

      if (!("k" in entry) || !("v" in entry) || Object.keys(entry).length !== 2)
        throw new TypeError("invalid JSON map pair");

      return [dataFromJson(entry.k), dataFromJson(entry.v)];
    }),
  };
}

/**
 * Decode a two-field constructor variant after dataFromJson checks the outer key count.
 * Decimal alternatives must be unsigned without leading zeros; numeric alternatives are
 * validated for safe integer precision by constr. Fields are recursively decoded, not coerced.
 */
function constructorFromJson(value: Record<string, unknown>): DataConstr {
  if (
    (typeof value.constructor === "number" || typeof value.constructor === "string") &&
    Array.isArray(value.fields)
  ) {
    const tag = value.constructor;

    if (typeof tag === "string" && !/^(0|[1-9][0-9]*)$/.test(tag))
      throw new TypeError("invalid decimal constructor index");

    return constr(typeof tag === "string" ? BigInt(tag) : tag, value.fields.map(dataFromJson));
  }

  throw new TypeError("invalid Data JSON shape");
}

/**
 * Read the exact supported JSON variant shapes without coercing strings, numbers or fields.
 * Integer payloads must be decimal strings; constructor alternatives may also be safe numbers.
 * Rebuilds semantic Data and rejects extra variant keys, but does not impose recursion,
 * serialized-size or recipient-datum budgets. Apply those limits at the appropriate boundary.
 */
export function dataFromJson(json: unknown): PlutusData {
  const value = object(json);
  const fieldCount = Object.keys(value).length;

  if ("int" in value && fieldCount === 1) return integerFromJson(value.int);

  if ("bytes" in value && fieldCount === 1) {
    if (typeof value.bytes !== "string") throw new TypeError("invalid JSON bytes");

    return bytes(value.bytes);
  }

  if ("list" in value && fieldCount === 1) {
    if (!Array.isArray(value.list)) throw new TypeError("invalid JSON list");

    return value.list.map(dataFromJson);
  }

  if ("map" in value && fieldCount === 1) return mapFromJson(value.map);

  if (fieldCount === 2) return constructorFromJson(value);

  throw new TypeError("invalid Data JSON shape");
}
