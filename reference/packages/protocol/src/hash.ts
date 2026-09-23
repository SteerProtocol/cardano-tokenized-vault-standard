/** Protocol digest adapter over the maintained Noble implementation. */
import { blake2b } from "@noble/hashes/blake2.js";

/** BLAKE2b with a 32-byte digest, not a truncated 64-byte digest. */
export function blake2b256(input: Uint8Array): Uint8Array {
  return blake2b(input, { dkLen: 32 });
}
