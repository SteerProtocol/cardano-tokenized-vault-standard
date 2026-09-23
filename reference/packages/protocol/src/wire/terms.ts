/** Immutable Terms encoding and commitment; field order and domain separation are part of identity. */
import { bytes, constr as C, constructorIndex, encodeData, hex, isConstr } from "../data/index.js";
import { blake2b256 } from "../hash.js";
import { integer, positive, quantity as q } from "../math/integer.js";
import type { DataConstr, PlutusData, Terms } from "../types.js";
import {
  assetData,
  assetFromData,
  b28,
  b32,
  destinationData,
  destinationFromData,
  fields,
  option,
  readBytes,
  readOption,
  sized,
  TERMS_DOMAIN,
} from "./primitives.js";

/**
 * Encode unrestricted settlement as its own variant; null is different from an explicit key set.
 * A key set must contain 1..16 valid 28-byte keys in strictly increasing byte order.
 * Case-equivalent duplicates and unsorted input throw rather than being silently normalized.
 */
function settlersData(keys: string[] | null): DataConstr {
  // Unrestricted settlement and an explicit key set have distinct constructors; an empty set is invalid.
  if (keys === null) return C(0);

  if (keys.length < 1 || keys.length > 16) throw new Error("settler keys count");

  keys.forEach(b28);

  if (
    keys.some((key, i) => {
      const previous = keys[i - 1];

      return previous !== undefined && previous.toLowerCase() >= key.toLowerCase();
    })
  )
    throw new Error("settler keys must be sorted and unique");

  return C(1, [keys.map(b28)]);
}

/**
 * Distinguish the unrestricted constructor from an explicitly encoded key list.
 * Normalize key bytes, then reuse settlersData to enforce nonempty cardinality and byte ordering.
 * Do not sort during decoding: reordering would accept a Terms representation the encoder rejects.
 */
function settlersFromData(data: PlutusData): string[] | null {
  if (isConstr(data) && constructorIndex(data.constr) === 0n) {
    fields(data, 0, 0, "Any settler");

    return null;
  }

  const [list] = fields(data, 1, 1, "KeySet");

  if (!Array.isArray(list)) throw new Error("invalid key list");

  const keys = list.map((key) => readBytes(key, 28));

  settlersData(keys);

  return keys;
}

/**
 * Encode profile-0 immutable Terms in their commitment field order, bounded to 4,096 preferred bytes.
 * Validate scalar ranges, optional fields, destinations and ordered settler keys.
 * The wire accepts capability masks 1..15; compiled-family support and viable entry/exit lifecycle
 * are separate questions that a valid encoding does not establish.
 */
export function termsData(t: Terms): DataConstr {
  return sized(
    C(0, [
      integer(t.profile, "profile", 0n, 0n),
      b32(t.networkDomain),
      assetData(t.underlying),
      positive(t.virtualShares, "virtual shares"),
      option(t.maxBacking, q),
      integer(t.entryBps, "entry bps", 0n, 9999n),
      integer(t.exitBps, "exit bps", 0n, 9999n),
      destinationData(t.feeDestination),
      option(t.pauseKey, b28),
      settlersData(t.settlers),
      integer(t.executionModes, "execution modes", 1n, 15n),
      integer(t.maxBatch, "max batch", 1n, 16n),
      option(t.descriptorHash, b32),
    ]),
    4096,
    "Terms",
  );
}

/**
 * Decode exactly thirteen Terms fields, normalizing byte identifiers to lowercase hex.
 * Re-run the encoder's semantic and preferred-size checks, including settler ordering.
 * This validates the Terms schema only; it does not bind them to a particular Config or deployment.
 */
export function termsFromData(data: PlutusData): Terms {
  const f = fields(data, 0, 13, "Terms");
  const result: Terms = {
    profile: integer(f[0], "profile", 0n, 0n),
    networkDomain: readBytes(f[1], 32),
    underlying: assetFromData(f[2]),
    virtualShares: positive(f[3]),
    maxBacking: readOption(f[4], q),
    entryBps: integer(f[5], "entry bps", 0n, 9999n),
    exitBps: integer(f[6], "exit bps", 0n, 9999n),
    feeDestination: destinationFromData(f[7]),
    pauseKey: readOption(f[8], (value) => readBytes(value, 28)),
    settlers: settlersFromData(f[9]),
    executionModes: integer(f[10], "execution modes", 1n, 15n),
    maxBatch: integer(f[11], "max batch", 1n, 16n),
    descriptorHash: readOption(f[12], (value) => readBytes(value, 32)),
  };

  termsData(result);

  return result;
}

/**
 * Return lowercase BLAKE2b-256 of the fixed TERMS domain prefix followed by preferred Terms CBOR.
 * Terms are validated first; JSON formatting, hex letter case and accepted alternative CBOR
 * spellings do not define the commitment. Ordered Data map pairs inside Terms remain significant.
 * The result binds Terms content but does not authenticate who published it.
 */
export function termsHash(terms: Terms): string {
  const domain = bytes(TERMS_DOMAIN),
    encoded = encodeData(termsData(terms));
  const input = new Uint8Array(domain.length + encoded.length);

  input.set(domain);
  input.set(encoded, domain.length);

  return hex(blake2b256(input));
}
