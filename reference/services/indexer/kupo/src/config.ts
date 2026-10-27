/** Validate operator input before package resolution or discovery has side effects. */
import { readFileSync } from "node:fs";
import {
  type NetworkIdentity,
  networkIdentity,
  type PluginRegistration,
  pluginPackageName,
  pluginRegistrations,
} from "@ctvs/plugins/indexer";
import { parse } from "semver";

export interface KupoConfig {
  network: NetworkIdentity;
  additionalPackages: Record<string, string>;
  registrations: PluginRegistration[];
}

function object(
  value: unknown,
  label: string,
  allowed?: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);

  const raw = value as Record<string, unknown>;

  if (allowed && Object.keys(raw).some((key) => !allowed.includes(key)))
    throw new Error(`${label} contains unknown fields`);

  return raw;
}

function exactVersion(value: unknown): string {
  const parsed = typeof value === "string" ? parse(value) : null;
  const canonical = parsed
    ? parsed.version + (parsed.build.length ? `+${parsed.build.join(".")}` : "")
    : undefined;

  if (typeof value !== "string" || canonical !== value)
    throw new Error("additional packages require canonical exact versions");

  return value;
}

function additionalPackages(value: unknown) {
  const raw = value === undefined ? {} : object(value, "additionalPackages");

  return Object.fromEntries(
    Object.entries(raw).map(([name, version]) => [pluginPackageName(name), exactVersion(version)]),
  );
}

export function parseKupoConfig(value: unknown): KupoConfig {
  const raw = object(value, "Kupo configuration", [
    "network",
    "additionalPackages",
    "registrations",
  ]);
  const network = networkIdentity(
    object(raw.network, "network", ["networkId", "networkMagic", "genesisHash"]),
  );

  if (!Array.isArray(raw.registrations) || raw.registrations.length === 0)
    throw new Error("at least one plugin registration is required");

  const registrations = pluginRegistrations(raw.registrations);

  for (const entry of raw.registrations)
    object(entry, "registration", ["id", "package", "deployment"]);

  return {
    network,
    additionalPackages: additionalPackages(raw.additionalPackages),
    registrations,
  };
}

export function loadKupoConfig(filename: string): KupoConfig {
  return parseKupoConfig(JSON.parse(readFileSync(filename, "utf8")));
}
