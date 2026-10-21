/** Explicit ledger-domain DTO codecs, usable without a node, CBOR runtime or wallet library. */

import type { Deployment } from "@ctvs/planning";
import type { Address, Asset, PlutusData, State, Terms } from "@ctvs/protocol";
import type { NetworkBinding, Observation } from "../types.js";
import {
  array,
  type Codec,
  count,
  fields,
  hex,
  integer,
  invalid,
  literal,
  nullable,
  object,
  quantity,
  text,
} from "./schema.js";

export const point = fields({ slot: integer(BigInt(Number.MAX_SAFE_INTEGER)), blockHash: hex(32) });
export const outRef = fields({ txId: hex(32), index: integer(65535n) });
export const network: Codec<NetworkBinding> = fields({
  name: text,
  networkId: literal(0, 1),
  networkMagic: count,
  genesisHash: hex(32),
  domain: hex(32),
});
export const credential = fields({ type: literal("key", "script"), hash: hex(28) });
export const address: Codec<Address> = fields({ payment: credential, stake: nullable(credential) });
export const asset: Codec<Asset> = {
  decode: (v) =>
    v === "ada" ? v : fields({ policy: hex(28), name: hex(undefined, 32) }).decode(v),
  encode: (v) => v,
};

/** Data integers/bytes are tagged only inside Plutus Data, preserving ordered map pairs and alternatives. */
function decodeData(value: unknown, depth = 0): PlutusData {
  if (depth > 64) invalid("datum nesting limit");

  const raw = object(value);

  if (Object.keys(raw).length !== 1) invalid("ambiguous datum variant");

  if ("int" in raw) {
    if (
      typeof raw.int !== "string" ||
      raw.int.length > 65536 ||
      !/^(0|-?[1-9][0-9]*)$/.test(raw.int)
    )
      invalid("invalid datum integer");

    return BigInt(raw.int);
  }

  if ("bytes" in raw) {
    const bytes = hex().decode(raw.bytes);

    return Uint8Array.from(bytes.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
  }

  if ("list" in raw)
    return array({ decode: (v) => decodeData(v, depth + 1), encode: (v) => v }).decode(raw.list);

  if (Object.hasOwn(raw, "constructor")) {
    const c = fields({
      alternative: integer((1n << 64n) - 1n),
      fields: array({ decode: (v) => decodeData(v, depth + 1), encode: (v) => v }),
    }).decode(raw.constructor);

    return {
      constr:
        c.alternative <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(c.alternative) : c.alternative,
      fields: c.fields,
    };
  }

  if ("map" in raw) return { map: decodePairs(raw.map, depth) };

  return invalid("unknown datum variant");
}

function decodePairs(raw: unknown, depth: number): [PlutusData, PlutusData][] {
  if (!Array.isArray(raw) || raw.length > 20000) invalid("invalid datum map");

  return raw.map((pair) => {
    if (!Array.isArray(pair) || pair.length !== 2) invalid("invalid datum pair");

    return [decodeData(pair[0], depth + 1), decodeData(pair[1], depth + 1)];
  });
}

function encodeData(value: PlutusData): unknown {
  if (typeof value === "bigint") return { int: value.toString() };

  if (value instanceof Uint8Array)
    return { bytes: Array.from(value, (b) => b.toString(16).padStart(2, "0")).join("") };

  if (Array.isArray(value)) return { list: value.map(encodeData) };

  if ("constr" in value)
    return {
      constructor: { alternative: value.constr.toString(), fields: value.fields.map(encodeData) },
    };

  return { map: value.map.map(([k, v]) => [encodeData(k), encodeData(v)]) };
}

export const datum: Codec<PlutusData> = { decode: decodeData, encode: encodeData };
export const destination = fields({ address, datum: nullable(datum) });
export const terms: Codec<Terms> = fields({
  profile: integer(0n),
  networkDomain: hex(32),
  underlying: asset,
  virtualShares: quantity,
  maxBacking: nullable(quantity),
  entryBps: integer(9999n),
  exitBps: integer(9999n),
  feeDestination: destination,
  pauseKey: nullable(hex(28)),
  settlers: nullable(array(hex(28), 16)),
  executionModes: integer(15n),
  maxBatch: integer(16n),
  descriptorHash: nullable(hex(32)),
});
export const state: Codec<State> = fields({
  vaultPolicy: hex(28),
  termsHash: hex(32),
  sequence: quantity,
  backingAssets: quantity,
  economicSupply: quantity,
  accruedFees: quantity,
  storageLovelace: quantity,
  pauseFlags: integer(3n),
});
export const deployment: Codec<Deployment> = fields({
  network: text,
  networkDomain: hex(32),
  policy: hex(28),
  configLock: hex(28),
  termsHash: hex(32),
  configRef: outRef,
  buildId: text,
  chainPoint: point,
  family: literal("ctvs1", "ctvs2"),
  claimScript: nullable(hex(28)),
}) as Codec<Deployment>;

export function observation<T>(codec: Codec<T>): Codec<Observation<T>> {
  return {
    decode(v) {
      const raw = object(v);

      return raw.status === "known"
        ? (fields({ status: literal("known"), value: codec }).decode(v) as Observation<T>)
        : fields({
            status: literal("unknown", "unsupported", "stale", "not_applicable"),
            reason: text,
          }).decode(v);
    },
    encode(v) {
      return v.status === "known" ? { status: v.status, value: codec.encode(v.value) } : v;
    },
  };
}
