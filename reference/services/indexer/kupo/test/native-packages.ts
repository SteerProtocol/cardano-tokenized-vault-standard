/** Run installation imports in Node's ESM loader, outside Vitest's module cache. */
import { discoverPlugins } from "@ctvs/plugins/indexer";
import type { KupoConfig } from "../src/config.js";
import { type PackageOptions, resolvePackages } from "../src/packages.js";

const input = JSON.parse(process.argv[2] ?? "{}");
const results = [];

for (const config of input.configs as KupoConfig[]) {
  const options: PackageOptions = {
    ...input.options,
    bundled: {},
    signal: new AbortController().signal,
  };
  const importer = await resolvePackages(config, options);
  const name = config.registrations[0]?.package;

  if (!name) throw new Error("missing native fixture registration");

  const module = await importer(name);

  results.push({
    module,
    reused: (await importer(name)) === module,
    discovered: await discoverPlugins(
      config.registrations,
      config.network,
      options.signal,
      importer,
    ),
  });
}

console.log(JSON.stringify(results));
