/** Projects recovery fields from raw Request CBOR while retaining the economic body unchanged. */
import { Cbor, CborUInt, LazyCborArray, type LazyCborObj, LazyCborTag } from "@harmoniclabs/cbor";
import { cborTagToConstrNumber } from "@harmoniclabs/plutus-data";
import { type DecodeOptions, decodeData } from "../data/codec.js";
import { bytes } from "../data/value.js";
import type { RecoveryCborProjection } from "../types.js";
import { version } from "./primitives.js";
import { recoveryFromData } from "./requests.js";

/** The maintained parser validates CBOR framing and preserves raw child slices. */
function parse(raw: Uint8Array): LazyCborObj {
  try {
    const { parsed, offset } = Cbor.parseLazyWithOffset(raw);

    if (offset !== raw.length) throw new Error("trailing CBOR");

    return parsed;
  } catch (cause) {
    if (cause instanceof RangeError && /call stack|array length/i.test(cause.message))
      throw new RangeError("CBOR parser resource limit exceeded", { cause });

    throw cause;
  }
}

/**
 * Locate exactly four raw children of the Request constructor without decoding its economics.
 * Accept compact or extended constructor spelling, but extended alternative 1 must use Word64
 * rather than a bignum substitute. Returned slices retain the parser's original child encodings.
 */
function requestFields(raw: Uint8Array): [Uint8Array, Uint8Array, Uint8Array, Uint8Array] {
  const root = parse(raw);

  if (!(root instanceof LazyCborTag)) throw new Error("invalid Request constructor/arity");

  let tag = cborTagToConstrNumber(root.tag);
  let fields = root.data;

  if (root.tag === 102n) {
    if (!(fields instanceof LazyCborArray) || fields.array.length !== 2)
      throw new Error("invalid extended Request constructor");

    const [indexBytes, fieldBytes] = fields.array as [Uint8Array, Uint8Array];
    const index = parse(indexBytes);

    if (!(index instanceof CborUInt) || index.isBigNum())
      throw new Error("invalid extended Request constructor");

    tag = index.num;
    fields = parse(fieldBytes);
  }

  if (tag !== 1n || !(fields instanceof LazyCborArray) || fields.array.length !== 4)
    throw new Error("invalid Request constructor/arity");

  // Exact length was checked above; retain the dependency's raw child slices.
  return fields.array as [Uint8Array, Uint8Array, Uint8Array, Uint8Array];
}

/**
 * Project the exact supported Recovery without materializing the economic body.
 * maxBytes bounds the entire CBOR item. maxDepth/maxNodes bound each projected
 * field, not the uninterpreted body. The maintained parser still scans nested
 * CBOR framing and can fail closed at its runtime recursion limit.
 * This validates recovery shape only, not economic Data or ledger eligibility.
 */
export function requestRecoveryFromCbor(
  input: string | Uint8Array,
  options: DecodeOptions = {},
): RecoveryCborProjection {
  const { maxBytes = 1_048_576, maxDepth = 64, maxNodes = 100_000 } = options;

  for (const [name, limit] of Object.entries({ maxBytes, maxDepth, maxNodes })) {
    if (!Number.isSafeInteger(limit) || limit < 0)
      throw new RangeError(`${name} must be a nonnegative safe integer`);
  }

  const raw = typeof input === "string" ? bytes(input) : input;

  if (!(raw instanceof Uint8Array) || raw.length > maxBytes)
    throw new RangeError("invalid or oversized CBOR");

  const [magic, wireVersion, recovery, economicBody] = requestFields(raw);

  version(decodeData(magic, options), decodeData(wireVersion, options));

  return {
    recovery: recoveryFromData(decodeData(recovery, options)),
    economicBodyCbor: economicBody.slice(),
  };
}
