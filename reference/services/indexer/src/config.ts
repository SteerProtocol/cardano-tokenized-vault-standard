/** Validated local bootstrap identity and conservative workload limits; no tip-based bootstrap fallback. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { NetworkBinding, ReviewedBuild } from "@ctvs/integration";
import type { ChainPoint } from "@ctvs/planning";

export type Tracking = { mode: "all" } | { mode: "selected"; vaults: string[] };
/** Operator attestation: the endpoint's database has continuously retained this coverage. */
export type KupoCoverage = { since: "origin"; match: "*"; spent: "retain" };
export interface Limits {
  maxBlocks: number;
  maxTransactions: number;
  maxUtxos: number;
  maxRecords: number;
  maxBlockBytes: number;
  maxHistoryBytes: number;
  maxLagSlots: number;
  requestTimeoutMs: number;
  reconnectDelayMs: number;
  lookupMaxAgeMs: number;
}
export interface IndexerConfig {
  network: NetworkBinding;
  intersection: ChainPoint;
  reviewedBuilds: ReviewedBuild[];
  tracking: Tracking;
  genesisPath: string;
  genesisStart: string;
  database: string;
  sources: { kupo: string; ogmios: string };
  kupoCoverage: KupoCoverage | null;
  http: { host: string; port: number };
  limits: Limits;
}

export function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);

  return value as Record<string, unknown>;
}

export function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be text`);

  return value;
}

export function unsigned(value: unknown, label: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > maximum)
    throw new Error(`${label} must be a nonnegative safe integer`);

  return value;
}

export function hex(value: unknown, bytes: number, label: string): string {
  const result = text(value, label).toLowerCase();

  if (!new RegExp(`^[a-f0-9]{${bytes * 2}}$`).test(result))
    throw new Error(`${label} has invalid hex`);

  return result;
}

/** External cursors use decimal strings; an all-zero hash is not an accepted bootstrap block. */
export function point(value: unknown): ChainPoint {
  const raw = object(value, "chain point");
  const slot = text(raw.slot, "slot");
  const blockHash = hex(raw.blockHash, 32, "block hash");

  if (
    !/^(0|[1-9][0-9]*)$/.test(slot) ||
    blockHash === "00".repeat(32) ||
    BigInt(slot) > BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw new Error("a real accepted intersection is required");

  return { slot: BigInt(slot), blockHash };
}

function tracking(value: unknown): Tracking {
  const raw = object(value, "tracking");

  if (raw.mode === "all" && raw.vaults === undefined) return { mode: "all" };

  if (raw.mode !== "selected" || !Array.isArray(raw.vaults) || raw.vaults.length === 0)
    throw new Error("tracking requires all, or selected with a nonempty vault list");

  const vaults = raw.vaults.map((policy) => hex(policy, 28, "vault policy")).sort();

  if (new Set(vaults).size !== vaults.length) throw new Error("duplicate selected vault");

  return { mode: "selected", vaults };
}

function script(value: unknown) {
  const raw = object(value, "reviewed script");
  const bytes = text(raw.script, "script").toLowerCase();

  if (raw.type !== "PlutusV3" || !/^(?:[a-f0-9]{2})+$/.test(bytes))
    throw new Error("reviewed script must contain PlutusV3 CBOR hex");

  return { type: "PlutusV3" as const, script: bytes };
}

function builds(value: unknown): ReviewedBuild[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("reviewedBuilds is required");

  const result = value.map((entry): ReviewedBuild => {
    const raw = object(entry, "reviewed build");

    if (raw.family !== "ctvs1" && raw.family !== "ctvs2") throw new Error("unknown build family");

    const template = text(raw.vaultTemplate, "vaultTemplate").toLowerCase();

    if (!/^(?:[a-f0-9]{2})+$/.test(template)) throw new Error("invalid vault template");

    if (raw.family === "ctvs1" && raw.claim !== null) throw new Error("CTVS-1 has no Claim script");

    return {
      family: raw.family,
      buildId: text(raw.buildId, "buildId"),
      vaultTemplate: template,
      config: script(raw.config),
      claim: raw.family === "ctvs2" ? script(raw.claim) : null,
    };
  });

  if (new Set(result.map((build) => build.family)).size !== result.length)
    throw new Error("supply one reviewed build per enabled family");

  return result.sort((a, b) => a.family.localeCompare(b.family));
}

const defaults: Limits = {
  maxBlocks: 2000,
  maxTransactions: 10000,
  maxUtxos: 20000,
  maxRecords: 20000,
  maxBlockBytes: 2_000_000,
  maxHistoryBytes: 64_000_000,
  maxLagSlots: 0,
  requestTimeoutMs: 10000,
  reconnectDelayMs: 3000,
  lookupMaxAgeMs: 10000,
};

function limits(value: unknown): Limits {
  const raw = value === undefined ? {} : object(value, "limits");
  const result = { ...defaults };

  for (const key of Object.keys(defaults) as (keyof Limits)[]) {
    result[key] = unsigned(raw[key] ?? defaults[key], key);

    if (key !== "maxLagSlots" && result[key] === 0) throw new Error(`${key} must be positive`);
  }

  if (Object.keys(raw).some((key) => !(key in defaults))) throw new Error("unknown workload limit");

  if (result.lookupMaxAgeMs > 60000) throw new Error("lookupMaxAgeMs cannot exceed 60000");

  return result;
}

function coverage(value: unknown): KupoCoverage | null {
  if (value === undefined || value === null) return null;

  const raw = object(value, "kupoCoverage");

  if (
    raw.since !== "origin" ||
    raw.match !== "*" ||
    raw.spent !== "retain" ||
    Object.keys(raw).length !== 3
  )
    throw new Error("kupoCoverage requires origin, wildcard and retained spent outputs");

  return { since: "origin", match: "*", spent: "retain" };
}

function endpoint(value: unknown): string {
  const url = new URL(text(value, "endpoint"));

  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("endpoint must be an HTTP(S) URL without credentials or query parameters");

  return url.toString().replace(/\/$/, "");
}

/** Normalize configuration before its identity is bound into the journal. Relative paths follow the config file. */
export function loadConfig(filename: string): IndexerConfig {
  const raw = object(JSON.parse(readFileSync(filename, "utf8")), "configuration");
  const network = object(raw.network, "network");
  const networkId = unsigned(network.networkId, "networkId", 1) as 0 | 1;
  const binding: NetworkBinding = {
    name: text(network.name, "network name"),
    networkId,
    networkMagic: unsigned(network.networkMagic, "networkMagic", 0xffffffff),
    genesisHash: hex(network.genesisHash, 32, "genesisHash"),
    domain: hex(network.domain, 32, "Terms network domain"),
  };
  const base = dirname(resolve(filename));
  const genesisPath = resolve(base, text(raw.genesisPath, "genesisPath"));
  const genesisBytes = readFileSync(genesisPath);

  if (createHash("sha256").update(genesisBytes).digest("hex") !== binding.genesisHash)
    throw new Error("Shelley genesis file hash mismatch");

  const genesis = object(JSON.parse(genesisBytes.toString()), "Shelley genesis");
  const genesisStart = text(genesis.systemStart, "systemStart");

  if (
    genesis.networkMagic !== binding.networkMagic ||
    genesis.networkId !== (networkId === 1 ? "Mainnet" : "Testnet") ||
    !Number.isFinite(Date.parse(genesisStart))
  )
    throw new Error("genesis network identity mismatch");

  const sources = object(raw.sources, "sources");
  const http = object(raw.http, "http");
  const port = unsigned(http.port, "HTTP port", 65535);

  if (port === 0) throw new Error("HTTP port must be positive");

  return {
    network: binding,
    intersection: point(raw.intersection),
    reviewedBuilds: builds(raw.reviewedBuilds),
    tracking: tracking(raw.tracking),
    genesisPath,
    genesisStart,
    database: resolve(base, text(raw.database, "database")),
    sources: { kupo: endpoint(sources.kupo), ogmios: endpoint(sources.ogmios) },
    kupoCoverage: coverage(raw.kupoCoverage),
    http: { host: text(http.host, "HTTP host"), port },
    limits: limits(raw.limits),
  };
}

/** Endpoints and filesystem locations can move; economic identity, reviewed bytes and scope cannot silently change. */
export function journalIdentity(config: IndexerConfig): string {
  return JSON.stringify({
    network: config.network,
    reviewedBuilds: config.reviewedBuilds,
    tracking: config.tracking,
    intersection: {
      slot: config.intersection.slot.toString(),
      blockHash: config.intersection.blockHash,
    },
  });
}
