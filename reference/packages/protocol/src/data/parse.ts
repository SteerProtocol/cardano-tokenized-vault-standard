/** Preserves CBOR tag/chunk structure until Plutus-specific validation can inspect it. */
import {
  Cbor,
  CborArray,
  CborBytes,
  CborMap,
  CborNegInt,
  type CborObj,
  CborTag,
  CborUInt,
  LazyCborArray,
  LazyCborMap,
  type LazyCborObj,
  LazyCborTag,
} from "@harmoniclabs/cbor";

/** A byte string or integer magnitude uses definite chunks of at most 64 bytes. */
export function validateByteChunks(obj: CborBytes): void {
  if (
    obj.isDefiniteLength
      ? obj.bytes.length > 64
      : Array.isArray(obj.chunks) &&
        obj.chunks.some((chunk) => !chunk.isDefiniteLength || chunk.bytes.length > 64)
  )
    throw new Error("invalid Plutus byte chunk");
}

/** HarmonicLabs' eager parser interprets empty integer magnitudes prematurely.
 * Its lazy parser retains tag and chunk objects, so legal zero magnitudes can
 * be normalized before conversion. All generic CBOR parsing stays in the library.
 * The library's recursive scanner can reach its runtime limit before our tree
 * budget, which is surfaced explicitly as a resource error. */
export function parseDataCbor(raw: Uint8Array, maxDepth: number, maxNodes: number): CborObj {
  let nodes = 0;

  function parse(input: Uint8Array, depth: number): CborObj {
    const { parsed, offset } = Cbor.parseLazyWithOffset(input);

    if (offset !== input.length) throw new Error("trailing CBOR");

    return materialize(parsed, depth);
  }

  /**
   * Rebuild lazy children under the one outer structural budget, preserving array/map length forms.
   * Repeated parse calls for child slices must not reset node counts or depth.
   * Integer-tag normalization retains the tagged-magnitude distinction for later constructor checks.
   */
  function materialize(obj: LazyCborObj, depth: number): CborObj {
    if (++nodes > maxNodes || depth > maxDepth)
      throw new RangeError("CBOR structural budget exceeded");

    if (obj instanceof LazyCborArray)
      return new CborArray(
        obj.array.map((item) => parse(item, depth + 1)),
        { indefinite: obj.indefinite },
      );

    if (obj instanceof LazyCborMap)
      return new CborMap(
        obj.map.map(({ k, v }) => ({ k: parse(k, depth + 1), v: parse(v, depth + 1) })),
        { indefinite: obj.indefinite },
      );

    if (obj instanceof LazyCborTag) {
      const data = materialize(obj.data, depth + 1);

      if ((obj.tag === 2n || obj.tag === 3n) && data instanceof CborBytes) {
        validateByteChunks(data);

        // Preserve a tagged-integer marker even for zero so that it cannot
        // masquerade as the Word64 alternative in an extended constructor.
        const magnitude = data.bytes.length === 0 ? new CborBytes(new Uint8Array([0])) : data;

        return obj.tag === 2n ? CborUInt.bigNum(magnitude) : CborNegInt.bigNum(magnitude);
      }

      return new CborTag(obj.tag, data);
    }

    return obj;
  }

  try {
    return parse(raw, 0);
  } catch (cause) {
    if (cause instanceof RangeError && /call stack|array length/i.test(cause.message))
      throw new RangeError("CBOR parser resource limit exceeded", { cause });

    throw cause;
  }
}
