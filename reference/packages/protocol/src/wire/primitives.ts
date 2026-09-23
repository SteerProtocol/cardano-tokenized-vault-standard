/** Profile wire leaves and identity rules; semantic addresses here do not encode a network ID. */
import {
  bytes,
  constr as C,
  constructorIndex,
  encodeData,
  hex,
  isConstr,
  validateBoundedData,
} from "../data/index.js";
import { integer } from "../math/integer.js";
import type {
  Address,
  Asset,
  Credential,
  CredentialType,
  DataConstr,
  Destination,
  OutRef,
  PlutusData,
} from "../types.js";

export const MAGIC = "43545653";
export const TERMS_DOMAIN = "435456532f48322f5445524d5300";
export const NAMES = { id: "4944", state: "5354415445", share: "5348415245" } as const;

export const b28 = (value: string): Uint8Array => bytes(value, 28);

export const b32 = (value: string): Uint8Array => bytes(value, 32);

export const outputIndex = (value: unknown): bigint => integer(value, "output index", 0n, 65_535n);

/** This profile uses Some = constructor 0 with one field and None = constructor 1 with none. */
export const option = <T>(value: T | null, encode: (value: T) => PlutusData): DataConstr =>
  value === null ? C(1) : C(0, [encode(value)]);

/**
 * Check the preferred encoded byte length against a role-specific ceiling and return the same Data.
 * The bound is on normalized serialization, not the original accepted CBOR spelling.
 * Use decode budgets separately to cap the size and structure of untrusted input bytes.
 */
export function sized<T extends PlutusData>(data: T, maximum: number, name: string): T {
  if (encodeData(data).length > maximum) throw new RangeError(`${name} normalized byte bound`);

  return data;
}

type DataFields<N extends number, A extends PlutusData[] = []> = A["length"] extends N
  ? A
  : DataFields<N, [...A, PlutusData]>;

/**
 * Require an exact constructor alternative and field count, then expose its existing field array.
 * Trailing fields are rejected rather than tolerated as extensions; number/bigint alternatives
 * are compared by validated Word64 identity. Individual field semantics remain the caller's task.
 */
export function fields<N extends number>(
  data: PlutusData,
  tag: number | bigint,
  arity: N,
  name: string,
): DataFields<N> {
  if (
    !isConstr(data) ||
    constructorIndex(data.constr) !== constructorIndex(tag) ||
    data.fields.length !== arity
  )
    throw new TypeError(`invalid ${name} constructor/arity`);

  // The runtime guard establishes precisely the fixed tuple length.
  return data.fields as DataFields<N>;
}

export function readBytes(data: PlutusData, length?: number): string {
  if (!(data instanceof Uint8Array) || (length !== undefined && data.length !== length))
    throw new TypeError("invalid byte length/type");

  return hex(data);
}

export function readOption<T>(data: PlutusData, read: (value: PlutusData) => T): T | null {
  if (isConstr(data) && constructorIndex(data.constr) === 1n) {
    fields(data, 1, 0, "None");

    return null;
  }

  return read(fields(data, 0, 1, "Some")[0]);
}

export function version(magic: PlutusData, wireVersion: PlutusData): void {
  if (readBytes(magic, 4) !== MAGIC || wireVersion !== 2n)
    throw new Error("unsupported magic/wire version");
}

export function credentialData(value: Credential): DataConstr {
  if (value.type !== "key" && value.type !== "script") throw new Error("unsupported credential");

  return C(value.type === "key" ? 0 : 1, [b28(value.hash)]);
}

function credentialFromData(data: PlutusData): Credential {
  if (
    !isConstr(data) ||
    (constructorIndex(data.constr) !== 0n && constructorIndex(data.constr) !== 1n)
  )
    throw new Error("unsupported credential");

  return {
    type: constructorIndex(data.constr) === 0n ? "key" : "script",
    hash: readBytes(fields(data, data.constr, 1, "Credential")[0], 28),
  };
}

export const enterprise = (hash: string, type: CredentialType = "script"): Address => ({
  payment: { type, hash },
  stake: null,
});

/**
 * Encode a payment credential and optional inline stake credential as Plutus Address Data.
 * Credential hashes are exactly 28 bytes; pointer stake addresses have no supported representation.
 * This semantic address omits network ID, so a ledger adapter must bind it to the selected network.
 */
export function addressData(address: Address): DataConstr {
  return C(0, [
    credentialData(address.payment),
    option(address.stake, (stake) => C(0, [credentialData(stake)])),
  ]);
}

function addressFromData(data: PlutusData): Address {
  const [payment, stake] = fields(data, 0, 2, "Address");

  return {
    payment: credentialFromData(payment),
    stake: readOption(stake, (value) => credentialFromData(fields(value, 0, 1, "Inline stake")[0])),
  };
}

/**
 * Encode a semantic address plus optional recipient datum using this profile's option constructors.
 * Present datums must satisfy the opaque-data structural and normalized-byte bounds.
 * No bech32/network encoding, output funding or recipient authentication is performed.
 */
export function destinationData(destination: Destination): DataConstr {
  return C(0, [addressData(destination.address), option(destination.datum, validateBoundedData)]);
}

/**
 * Decode the exact Destination shape and normalize credential bytes to lowercase hex.
 * Validate optional recipient Data with the opaque-datum profile; null means no output datum.
 * The returned semantic address has no network ID and does not prove recipient control.
 */
export function destinationFromData(data: PlutusData): Destination {
  const [address, datum] = fields(data, 0, 2, "Destination");

  return { address: addressFromData(address), datum: readOption(datum, validateBoundedData) };
}

/**
 * Encode ADA distinctly from native assets without interpreting token metadata or labels.
 * Native policy hashes are 28 bytes and names are 0..32 complete bytes, including any CIP-67 prefix.
 * Hex syntax is validated; no external mint-policy or asset-existence check occurs.
 */
export function assetData(asset: Asset): DataConstr {
  if (asset === "ada") return C(0);

  const name = bytes(asset.name);

  if (name.length > 32) throw new RangeError("asset name exceeds 32 bytes");

  return C(1, [b28(asset.policy), name]);
}

/**
 * Decode the exact ADA/native-asset variant and normalize native bytes to lowercase hex.
 * Reject extra fields, invalid policy length and names beyond 32 bytes.
 * An empty native asset name remains valid and distinct from ADA.
 */
export function assetFromData(data: PlutusData): Asset {
  if (isConstr(data) && constructorIndex(data.constr) === 0n) {
    fields(data, 0, 0, "ADA");

    return "ada";
  }

  const [policy, name] = fields(data, 1, 2, "Native asset");
  const result = { policy: readBytes(policy, 28), name: readBytes(name) };

  assetData(result);

  return result;
}

/**
 * Return "ada" or a validated lowercase policyHex.assetNameHex identity key.
 * Retain every asset-name byte, including an empty name or a CIP-67 label prefix.
 * The separator is this SDK's internal convention, not a ledger unit encoding or metadata lookup.
 */
export function assetId(asset: Asset): string {
  assetData(asset);

  return asset === "ada" ? "ada" : `${asset.policy.toLowerCase()}.${asset.name.toLowerCase()}`;
}

export const outRefData = (ref: OutRef): DataConstr =>
  C(0, [b32(ref.txId), outputIndex(ref.index)]);

export function outRefFromData(data: PlutusData): OutRef {
  const [txId, index] = fields(data, 0, 2, "OutRef");

  return { txId: readBytes(txId, 32), index: outputIndex(index) };
}

/**
 * Validate a 32-byte transaction ID and bigint output index in 0..65,535.
 * Return the canonical lowercase txId#index key used for equality and map membership.
 * This establishes syntactic identity only, not transaction existence or an unspent output.
 */
export function refId(ref: OutRef): string {
  outRefData(ref);

  return `${ref.txId.toLowerCase()}#${ref.index}`;
}

/**
 * Validate the direct-reference overload's unknown entry before sorting or identity comparison.
 * Return a fresh txId/index pair while preserving valid hex spelling; unrelated fields are ignored.
 * Canonical casing is applied by identity comparisons, not by mutating the caller's entry.
 */
function assertReference(value: unknown): OutRef {
  if (
    value === null ||
    typeof value !== "object" ||
    !("txId" in value) ||
    typeof value.txId !== "string" ||
    !("index" in value)
  )
    throw new TypeError("expected output reference");

  const result = { txId: value.txId, index: outputIndex(value.index) };

  outRefData(result);

  return result;
}

/**
 * Return a shallow copy of 1..16 entries ordered by transaction bytes, then numeric output index.
 * Reject duplicate identities even when their hex casing differs. Optional getRef supplies
 * references for structured entries and must be stable across validation and sorting.
 * Neither the source array nor the entries' spelling and output associations are rewritten.
 */
export function sortedReferences(items: OutRef[]): OutRef[];
export function sortedReferences<T>(items: T[], getRef: (item: T) => OutRef): T[];

export function sortedReferences<T>(items: T[], getRef?: (item: T) => OutRef): T[] {
  if (!Array.isArray(items) || items.length < 1 || items.length > 16)
    throw new RangeError("entries count must be 1..16");

  const read = (item: T): OutRef => (getRef ? getRef(item) : assertReference(item));

  const seen = new Set<string>();

  for (const item of items) {
    const id = refId(read(item));

    if (seen.has(id)) throw new Error("duplicate output reference");

    seen.add(id);
  }

  return [...items].sort((a, b) => {
    const x = read(a),
      y = read(b),
      ah = x.txId.toLowerCase(),
      bh = y.txId.toLowerCase();

    return ah < bh ? -1 : ah > bh ? 1 : x.index < y.index ? -1 : x.index > y.index ? 1 : 0;
  });
}
