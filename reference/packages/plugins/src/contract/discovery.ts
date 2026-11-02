/** Common discovery output. Deployment input and guest bindings remain package-owned. */
import { getAddressDetails } from "@lucid-evolution/utils";
import { decimal, hex, object, unsigned } from "./validation.js";

export interface NetworkIdentity {
  networkId: number;
  networkMagic: number;
  genesisHash: string;
}

export interface CollectionPoint {
  slot: string;
  blockHash: string;
}
export type CollectionStart = { tag: "origin" } | { tag: "point"; val: CollectionPoint };
export type CollectionMatch =
  | { tag: "address" | "payment-credential" | "policy"; val: string }
  | { tag: "asset"; val: { policyId: string; assetName: string } };
export type HistoryRequirement = "unspent-sufficient" | "spent-required";
export interface CollectionRule {
  source: string;
  match: CollectionMatch;
  from: CollectionStart;
  history: HistoryRequirement;
}

export interface PluginRegistration {
  id: string;
  package: string;
  deployment: Record<string, unknown>;
}

/** Installed packages expose this adapter as discoveryPlugin. No network capability is supplied. */
export interface DiscoveryPackage {
  apiVersion: "CTVS-DISCOVERY-PACKAGE-1";
  name: string;
  version: string;
  open(
    deployment: Record<string, unknown>,
    network: NetworkIdentity,
    signal: AbortSignal,
  ): Promise<{
    discover(cursor: string | undefined, pageSize: number): unknown | Promise<unknown>;
  }>;
}

export interface DiscoveredRegistration {
  id: string;
  package: string;
  version: string;
  network: NetworkIdentity;
  rules: CollectionRule[];
}

export function networkIdentity(value: unknown): NetworkIdentity {
  const raw = object(value);

  return {
    networkId: unsigned(raw.networkId, 1),
    networkMagic: unsigned(raw.networkMagic, 0xffffffff),
    genesisHash: hex(raw.genesisHash, 32),
  };
}

export function sameNetwork(a: NetworkIdentity, b: NetworkIdentity): boolean {
  return (
    a.networkId === b.networkId &&
    a.networkMagic === b.networkMagic &&
    a.genesisHash === b.genesisHash
  );
}

function collectionMatch(value: unknown, network: NetworkIdentity): CollectionMatch {
  const raw = object(value);

  switch (raw.tag) {
    case "address": {
      if (typeof raw.val !== "string") throw new Error("invalid collection address");

      const details = getAddressDetails(raw.val);

      if (!details.paymentCredential || details.networkId !== network.networkId)
        throw new Error("collection requires a payment address on the configured network");

      return { tag: "address", val: details.address.bech32 };
    }
    case "payment-credential":
    case "policy":
      return { tag: raw.tag, val: hex(raw.val, 28) };
    case "asset": {
      const asset = object(raw.val);

      if (typeof asset.assetName !== "string" || !/^(?:[a-f0-9]{2}){0,32}$/.test(asset.assetName))
        throw new Error("invalid collection asset name");

      return {
        tag: "asset",
        val: { policyId: hex(asset.policyId, 28), assetName: asset.assetName },
      };
    }
    default:
      throw new Error("unsupported collection match");
  }
}

export function collectionRule(value: unknown, network: NetworkIdentity): CollectionRule {
  const raw = object(value);
  const start = object(raw.from);

  if (
    typeof raw.source !== "string" ||
    raw.source.length === 0 ||
    raw.source.length > 128 ||
    (raw.history !== "spent-required" && raw.history !== "unspent-sufficient")
  )
    throw new Error("invalid collection source or history");

  let from: CollectionStart;

  if (start.tag === "origin") from = { tag: "origin" };
  else if (start.tag === "point") {
    const point = object(start.val);

    from = {
      tag: "point",
      val: { slot: decimal(point.slot), blockHash: hex(point.blockHash, 32) },
    };
  } else throw new Error("invalid collection start");

  return {
    source: raw.source,
    match: collectionMatch(raw.match, network),
    from,
    history: raw.history,
  };
}

export function pluginPackageName(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 214 ||
    !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(value)
  )
    throw new Error("plugin must name an installed npm package");

  return value;
}

export function pluginRegistrations(value: unknown): PluginRegistration[] {
  if (value === undefined) return [];

  if (!Array.isArray(value)) throw new Error("plugin registrations must be an array");

  const ids = new Set<string>();

  return value.map((entry: unknown) => {
    const raw = object(entry);

    if (typeof raw.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(raw.id) || ids.has(raw.id))
      throw new Error("plugin registration IDs must be valid and unique");

    const name = pluginPackageName(raw.package);
    const deployment = object(raw.deployment);

    if (new TextEncoder().encode(JSON.stringify(deployment)).length > 1_048_576)
      throw new Error("plugin deployment exceeds 1 MiB");

    ids.add(raw.id);

    return { id: raw.id, package: name, deployment: structuredClone(deployment) };
  });
}
