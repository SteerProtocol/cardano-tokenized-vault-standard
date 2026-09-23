/** Adapts maintained CBOR/Data libraries to the profile's commitment bytes and accepted Data forms. */
import {
  Cbor,
  CborArray,
  CborBytes,
  CborMap,
  CborNegInt,
  type CborObj,
  CborTag,
  CborUInt,
} from "@harmoniclabs/cbor";
import {
  type Data,
  DataB,
  DataI,
  DataList,
  dataFromCborObj,
  dataToCborObj,
  DataConstr as LibraryConstr,
  DataMap as LibraryMap,
} from "@harmoniclabs/plutus-data";
import type { PlutusData } from "../types.js";
import { parseDataCbor, validateByteChunks } from "./parse.js";
import { bytes, constr, constructorIndex, isConstr } from "./value.js";

/**
 * Adapt semantic variants to the maintained Plutus Data types without sorting map pairs.
 * Constructor alternatives are checked before conversion; integer magnitudes remain arbitrary precision.
 * This internal conversion assumes well-shaped Data and does not impose decoder budgets.
 */
function toLibrary(data: PlutusData): Data {
  if (typeof data === "bigint") return new DataI(data);

  if (data instanceof Uint8Array) return new DataB(data);

  if (Array.isArray(data)) return new DataList(data.map(toLibrary));

  if (isConstr(data))
    return new LibraryConstr(constructorIndex(data.constr), data.fields.map(toLibrary));

  return new LibraryMap(data.map.map(([k, v]) => ({ fst: toLibrary(k), snd: toLibrary(v) })));
}

function fromLibrary(data: Data): PlutusData {
  if (data instanceof DataI) return data.int;

  if (data instanceof DataB) return data.bytes;

  if (data instanceof DataList) return data.list.map(fromLibrary);

  if (data instanceof LibraryConstr) return constr(data.constr, data.fields.map(fromLibrary));

  return { map: data.map.map(({ fst, snd }) => [fromLibrary(fst), fromLibrary(snd)]) };
}

/**
 * Select the profile commitment spelling on newly created library CBOR objects.
 * Maps become definite-length while their pair order stays intact; large bignum magnitudes
 * are split into legal 64-byte chunks. Generic head/tag encoding remains the library's job.
 * The result is a preferred spelling, not a byte-preserving rewrite of an original datum.
 */
function preferredObjects(obj: CborObj): CborObj {
  if (obj instanceof CborMap)
    return new CborMap(
      obj.map.map(({ k, v }) => ({ k: preferredObjects(k), v: preferredObjects(v) })),
      { indefinite: false },
    );

  if (obj instanceof CborArray)
    return new CborArray(obj.array.map(preferredObjects), { indefinite: obj.indefinite });

  if (obj instanceof CborTag) return new CborTag(obj.tag, preferredObjects(obj.data));

  if ((obj instanceof CborUInt || obj instanceof CborNegInt) && obj.bigNumEncoding !== undefined) {
    const encoded = obj.bigNumEncoding.bytes;

    if (encoded.length > 64) {
      const chunks: CborBytes[] = [];

      for (let offset = 0; offset < encoded.length; offset += 64)
        chunks.push(new CborBytes(encoded.slice(offset, offset + 64)));

      obj.bigNumEncoding = new CborBytes(chunks);
    }
  }

  return obj;
}

/**
 * Encode semantic Data using the profile's preferred commitment spelling.
 * Map order is preserved; equivalent accepted CBOR inputs need not round-trip to their original bytes.
 * No typed datum, normalized-size or recursion budget is enforced here. Role codecs apply
 * their own limits before this encoding is used for commitments or transaction construction.
 */
export function encodeData(data: PlutusData): Uint8Array {
  return Cbor.encode(preferredObjects(dataToCborObj(toLibrary(data))));
}

export interface DecodeOptions {
  maxBytes?: number;
  maxDepth?: number;
  maxNodes?: number;
}

/**
 * Reject generic CBOR tags that do not encode a Plutus constructor.
 * Extended tag 102 must contain exactly a Word64 alternative and a field array;
 * an arbitrary bignum with the same numeric value is not an equivalent alternative encoding.
 */
function assertConstructorTag(obj: CborTag): void {
  // Tag 102 carries a Word64 alternative, not an arbitrary positive bignum with the same value.
  if (obj.tag === 102n) {
    if (
      !(obj.data instanceof CborArray) ||
      obj.data.array.length !== 2 ||
      !(obj.data.array[0] instanceof CborUInt) ||
      obj.data.array[0].isBigNum() ||
      !(obj.data.array[1] instanceof CborArray)
    )
      throw new Error("invalid extended constructor");
  } else if (
    !((obj.tag >= 121n && obj.tag <= 127n) || (obj.tag >= 1280n && obj.tag <= 1400n)) ||
    !(obj.data instanceof CborArray)
  )
    throw new Error("unsupported CBOR tag");
}

/**
 * Whitelist Plutus Data forms before invoking the permissive library conversion.
 * One shared budget counts CBOR containers, tags and scalar descendants with root depth zero;
 * integer magnitudes and map keys also consume this budget. Valid byte chunks are checked here.
 * This accepts supported equivalent spellings without imposing a CTVS role-specific schema.
 */
function assertDataCbor(root: CborObj, maxDepth: number, maxNodes: number): void {
  // Descendants share this counter; restarting it per container would allow oversized trees.
  let nodes = 0;

  /**
   * Count the accepted CBOR structure, including constructor wrappers and bignum magnitudes.
   * This traversal must happen before conversion erases representation details needed to reject
   * unsupported tags and illegal byte chunks.
   */
  function walk(obj: CborObj, depth: number): void {
    if (++nodes > maxNodes || depth > maxDepth)
      throw new RangeError("CBOR structural budget exceeded");

    if (obj instanceof CborUInt || obj instanceof CborNegInt) {
      if (obj.bigNumEncoding !== undefined) walk(obj.bigNumEncoding, depth + 1);

      return;
    }

    if (obj instanceof CborBytes) {
      validateByteChunks(obj);

      return;
    }

    if (obj instanceof CborArray) {
      for (const item of obj.array) walk(item, depth + 1);

      return;
    }

    if (obj instanceof CborMap) {
      obj.map.forEach(({ k, v }) => {
        walk(k, depth + 1);
        walk(v, depth + 1);
      });

      return;
    }

    if (obj instanceof CborTag) {
      assertConstructorTag(obj);
      walk(obj.data, depth + 1);

      return;
    }

    throw new Error("unsupported CBOR type for Plutus Data");
  }

  walk(root, 0);
}

/**
 * Decode exactly one complete Plutus Data CBOR item from strict hex or raw bytes.
 * Reject trailing bytes, unsupported tags/types, invalid byte chunks and exceeded budgets.
 * Defaults bound the full item to 1 MiB, depth 64 and 100,000 CBOR nodes; limits must be
 * nonnegative safe integers. The result is semantic Data, not evidence of role or authenticity.
 */
export function decodeData(
  input: string | Uint8Array,
  { maxBytes = 1_048_576, maxDepth = 64, maxNodes = 100_000 }: DecodeOptions = {},
): PlutusData {
  for (const [name, limit] of Object.entries({ maxBytes, maxDepth, maxNodes })) {
    if (!Number.isSafeInteger(limit) || limit < 0)
      throw new RangeError(`${name} must be a nonnegative safe integer`);
  }

  const raw = typeof input === "string" ? bytes(input) : input;

  if (!(raw instanceof Uint8Array) || raw.length > maxBytes)
    throw new RangeError("invalid or oversized CBOR");

  const parsed = parseDataCbor(raw, maxDepth, maxNodes);

  assertDataCbor(parsed, maxDepth, maxNodes);

  return fromLibrary(dataFromCborObj(parsed));
}
