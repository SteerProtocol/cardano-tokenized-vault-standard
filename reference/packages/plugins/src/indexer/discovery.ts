/** Drain explicit installed registrations; preserve identity across shared collection rules. */
import {
  collectionRule,
  type DiscoveredRegistration,
  type DiscoveryPackage,
  type NetworkIdentity,
  networkIdentity,
  pluginRegistrations,
  sameNetwork,
} from "../contract/discovery.js";
import { object } from "../contract/validation.js";

export type PackageImporter = (name: string) => Promise<unknown>;

export function discoveryPackage(value: unknown, name: string): DiscoveryPackage {
  const raw = object(object(value).discoveryPlugin);

  if (
    raw.apiVersion !== "CTVS-DISCOVERY-PACKAGE-1" ||
    raw.name !== name ||
    typeof raw.version !== "string" ||
    raw.version.length === 0 ||
    raw.version.length > 128 ||
    typeof raw.open !== "function"
  )
    throw new Error("incompatible discovery package");

  return raw as unknown as DiscoveryPackage;
}

async function drain(
  guest: Awaited<ReturnType<DiscoveryPackage["open"]>>,
  network: NetworkIdentity,
  signal: AbortSignal,
) {
  const rules = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  let bytes = 0;

  for (let pageNumber = 0; pageNumber < 64; pageNumber++) {
    signal.throwIfAborted();

    const value: unknown = await guest.discover(cursor, 256);

    signal.throwIfAborted();
    bytes += new TextEncoder().encode(JSON.stringify(value)).length;

    if (bytes > 16_777_216) throw new Error("discovery byte budget exceeded");

    const page = object(value);

    if (
      page.schema !== "CTVS-DISCOVERY-1" ||
      !sameNetwork(networkIdentity(page.network), network) ||
      !Array.isArray(page.rules) ||
      page.rules.length > 256
    )
      throw new Error("invalid plugin discovery page");

    rules.push(...page.rules.map((rule: unknown) => collectionRule(rule, network)));

    if (page.nextCursor === undefined) return rules;

    if (
      typeof page.nextCursor !== "string" ||
      page.nextCursor.length > 1024 ||
      page.nextCursor.length === 0 ||
      seen.has(page.nextCursor)
    )
      throw new Error("invalid or repeated discovery cursor");

    seen.add(page.nextCursor);
    cursor = page.nextCursor;
  }

  throw new Error("plugin discovery exceeded 64 pages");
}

export async function discoverPlugins(
  registrations: unknown,
  expectedNetwork: NetworkIdentity,
  signal: AbortSignal,
  importer: PackageImporter = (name) => import(name),
): Promise<DiscoveredRegistration[]> {
  const enabled = pluginRegistrations(registrations);
  const network = networkIdentity(expectedNetwork);
  const packages = new Map<string, DiscoveryPackage>();
  const discovered: DiscoveredRegistration[] = [];

  for (const registration of enabled) {
    signal.throwIfAborted();

    let plugin = packages.get(registration.package);

    if (!plugin) {
      plugin = discoveryPackage(await importer(registration.package), registration.package);
      packages.set(registration.package, plugin);
    }

    const guest = await plugin.open(registration.deployment, structuredClone(network), signal);

    if (!guest || typeof guest.discover !== "function") throw new Error("missing discovery export");

    discovered.push({
      id: registration.id,
      package: plugin.name,
      version: plugin.version,
      network: structuredClone(network),
      rules: await drain(guest, network, signal),
    });
  }

  return discovered;
}
