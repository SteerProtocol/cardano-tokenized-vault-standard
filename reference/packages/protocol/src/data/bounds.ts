/** Bounds opaque recipient datums independently of the general Plutus Data decoder. */
import type { PlutusData } from "../types.js";
import { encodeData } from "./codec.js";
import { constructorIndex, equalData, isConstr } from "./value.js";

/**
 * Validate the opaque recipient-datum profile and return the same Data object unchanged.
 * Allow at most 256 semantic nodes, depth 16 from the root, signed 256-bit integers,
 * constructor alternatives 0..127 and 1,024-byte strings; reject semantically equal map keys.
 * The preferred encoded datum must also fit 1,024 bytes. Map order is never normalized.
 */
export function validateBoundedData(data: PlutusData): PlutusData {
  let nodes = 0;

  /**
   * Charge one shared semantic-node budget across sibling branches, counting map keys and values.
   * Map key equality is semantic and order-sensitive; no sorting or deduplication may change the datum.
   */
  function walk(value: PlutusData, depth: number): void {
    if (++nodes > 256 || depth > 16) throw new RangeError("opaque Data structural bound");

    if (typeof value === "bigint") {
      if (value < -(1n << 255n) || value >= 1n << 255n)
        throw new RangeError("opaque integer exceeds signed 256 bits");
    } else if (value instanceof Uint8Array) {
      if (value.length > 1024) throw new RangeError("opaque byte bound");
    } else if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
    } else if (isConstr(value)) {
      if (constructorIndex(value.constr) > 127n)
        throw new RangeError("opaque constructor must be 0..127");

      for (const item of value.fields) walk(item, depth + 1);
    } else {
      const keys: PlutusData[] = [];

      for (const [key, item] of value.map) {
        walk(key, depth + 1);
        walk(item, depth + 1);

        if (keys.some((seen) => equalData(seen, key)))
          throw new Error("duplicate equal opaque map key");

        keys.push(key);
      }
    }
  }

  walk(data, 0);

  // The final cap includes CBOR heads/chunk overhead, not just the byte-string payloads.
  if (encodeData(data).length > 1024) throw new RangeError("opaque normalized byte bound");

  return data;
}
