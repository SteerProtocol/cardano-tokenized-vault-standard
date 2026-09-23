/** Serializes integration envelopes without losing bigint precision or binary evidence at the JSON boundary. */
import { hex } from "@ctvs/protocol";
import type { Envelope } from "./types.js";

/**
 * Serialize a detached response without rounding ledger integers through JSON numbers.
 * Every bigint becomes a decimal string and each Uint8Array becomes hex; no type tags
 * or reviver are added, so consumers must decode fields using the response schema.
 * This is transport encoding, not canonical CBOR, a commitment or an evidence signature.
 */
export function responseToJson(response: Envelope<unknown>): string {
  return JSON.stringify(response, (_key, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value instanceof Uint8Array ? hex(value) : value,
  );
}
