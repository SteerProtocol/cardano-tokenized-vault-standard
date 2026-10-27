/** Resolve explicitly available packages without enabling deployments or running discovery. */
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { discoveryPackage, type PackageImporter } from "@ctvs/plugins/indexer";
import { type KupoConfig, parseKupoConfig } from "./config.js";
import { checkInstalledIdentity, installPackages } from "./package-cache.js";

export interface BundledPackage {
  version: string;
  load: () => Promise<unknown>;
}

export interface PackageOptions {
  bundled: Readonly<Record<string, BundledPackage>>;
  cacheDirectory: string;
  signal: AbortSignal;
  registry?: string;
}

function availablePackages(config: KupoConfig, bundled: PackageOptions["bundled"]) {
  const additional: Record<string, string> = {};
  const available = new Map(Object.entries(bundled).map(([name, entry]) => [name, entry.version]));

  for (const [name, version] of Object.entries(config.additionalPackages)) {
    const existing = available.get(name);

    if (existing !== undefined && existing !== version)
      throw new Error(`additional package conflicts with bundled version: ${name}`);

    if (existing === undefined) additional[name] = version;

    available.set(name, version);
  }

  for (const registration of config.registrations)
    if (!available.has(registration.package))
      throw new Error(`registered package is unavailable: ${registration.package}`);

  return { additional, available };
}

async function installedImporter(directory: string): Promise<PackageImporter> {
  // Resolve ESM import conditions relative to this installation, including import-only exports.
  const resolver = await import(pathToFileURL(join(directory, "import.mjs")).href);

  return resolver.load;
}

export async function resolvePackages(
  input: KupoConfig,
  options: PackageOptions,
): Promise<PackageImporter> {
  const config = parseKupoConfig(input);
  const { additional, available } = availablePackages(config, options.bundled);
  const enabled = new Set(config.registrations.map((registration) => registration.package));
  const loaded = new Map<string, Promise<unknown>>();

  options.signal.throwIfAborted();

  const directory = Object.keys(additional).length
    ? await installPackages(additional, options)
    : undefined;
  const installed = directory ? await installedImporter(directory) : undefined;

  options.signal.throwIfAborted();

  async function load(name: string): Promise<unknown> {
    options.signal.throwIfAborted();

    const version = available.get(name);
    const bundled = Object.hasOwn(options.bundled, name) ? options.bundled[name] : undefined;

    if (!version) throw new Error(`package is unavailable: ${name}`);

    if (directory && !bundled) await checkInstalledIdentity(directory, name, version);

    const module = bundled ? await bundled.load() : await installed?.(name);
    const plugin = discoveryPackage(module, name);

    options.signal.throwIfAborted();

    if (plugin.version !== version) throw new Error(`discovery package version mismatch: ${name}`);

    return module;
  }

  return async (name) => {
    options.signal.throwIfAborted();

    if (!enabled.has(name)) throw new Error(`package is not registered: ${name}`);

    let module = loaded.get(name);

    if (!module) {
      module = load(name);
      loaded.set(name, module);
    }

    return module;
  };
}
