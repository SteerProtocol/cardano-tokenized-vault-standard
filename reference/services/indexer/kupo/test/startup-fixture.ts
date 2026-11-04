/** Small mounted configuration and a discovery package; no reader or chain access. */
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DiscoveryPackage } from "@ctvs/plugins/indexer";
import { parseKupoConfig } from "../src/config.js";

export async function startupFixture() {
  const root = await mkdtemp(join(tmpdir(), "ctvs-kupo-startup-"));
  const mounted = join(root, "network with spaces");
  const genesisPath = join(mounted, "shelley.json");
  const genesis = { networkMagic: 42, networkId: "Testnet" };
  const bytes = JSON.stringify(genesis);
  const network = {
    networkId: 0,
    networkMagic: 42,
    genesisHash: createHash("sha256").update(bytes).digest("hex"),
  };
  const rule = {
    source: "fixture",
    match: { tag: "policy", val: "22".repeat(28) },
    from: { tag: "origin" },
    history: "spent-required",
  };
  const input = parseKupoConfig({
    network,
    registrations: [
      { id: "first", package: "@fixture/plugin", deployment: { rules: [rule] } },
      { id: "second", package: "@fixture/plugin", deployment: { rules: [rule] } },
    ],
  });
  const plugin: DiscoveryPackage = {
    apiVersion: "CTVS-DISCOVERY-PACKAGE-1",
    name: "@fixture/plugin",
    version: "1.0.0",
    open: async (deployment, network, signal) => {
      signal.throwIfAborted();

      return {
        discover: () => ({
          schema: "CTVS-DISCOVERY-1",
          network,
          rules: deployment.rules,
        }),
      };
    },
  };
  const options = {
    configPath: join(root, "kupo.json"),
    nodeConfigPath: join(mounted, "node.json"),
    nodeSocketPath: join(root, "socket with spaces"),
    dataDirectory: join(root, "data with spaces"),
    cacheDirectory: join(root, "package cache"),
    bundled: {
      "@fixture/plugin": {
        version: plugin.version,
        load: async () => ({ discoveryPlugin: plugin }),
      },
    },
    signal: new AbortController().signal,
  };

  await mkdir(mounted);
  await writeFile(genesisPath, bytes);
  await writeFile(options.nodeConfigPath, JSON.stringify({ ShelleyGenesisFile: "shelley.json" }));
  await writeFile(options.configPath, JSON.stringify(input));

  return {
    root,
    input,
    options,
    plugin,
    genesis,
    genesisPath,
    save: () => writeFile(options.configPath, JSON.stringify(input)),
    remove: () => rm(root, { recursive: true, force: true }),
  };
}
