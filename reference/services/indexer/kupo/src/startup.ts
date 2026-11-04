/** Prepare collection and managed storage before the executable can open Kupo's database. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { discoverPlugins, type NetworkIdentity, planCollections } from "@ctvs/plugins/indexer";
import { loadKupoConfig } from "./config.js";
import { prepareManagedStorage } from "./managed-storage.js";
import { type PackageOptions, resolvePackages } from "./packages.js";
import { type KupoProfile, kupoSettings } from "./settings.js";

export interface StartupOptions extends PackageOptions {
  configPath: string;
  nodeConfigPath: string;
  nodeSocketPath: string;
  dataDirectory: string;
  profile?: KupoProfile;
}

function checkNodeNetwork(filename: string, network: NetworkIdentity) {
  const config = JSON.parse(readFileSync(filename, "utf8"));

  if (typeof config?.ShelleyGenesisFile !== "string" || !config.ShelleyGenesisFile)
    throw new Error("Kupo node configuration requires ShelleyGenesisFile");

  const bytes = readFileSync(resolve(dirname(filename), config.ShelleyGenesisFile));
  const genesis = JSON.parse(bytes.toString("utf8"));

  if (
    createHash("sha256").update(bytes).digest("hex") !== network.genesisHash ||
    genesis?.networkMagic !== network.networkMagic ||
    genesis?.networkId !== (network.networkId === 1 ? "Mainnet" : "Testnet")
  )
    throw new Error("Kupo node configuration network identity mismatch");
}

export async function prepareKupo(options: StartupOptions): Promise<string[]> {
  options.signal.throwIfAborted();

  const config = loadKupoConfig(options.configPath);
  const nodeConfigPath = resolve(options.nodeConfigPath);

  checkNodeNetwork(nodeConfigPath, config.network);

  const importer = await resolvePackages(config, options);
  const discovered = await discoverPlugins(
    config.registrations,
    config.network,
    options.signal,
    importer,
  );
  const settings = kupoSettings(planCollections(config.network, discovered), options.profile);
  const dataDirectory = resolve(options.dataDirectory);

  options.signal.throwIfAborted();

  try {
    await prepareManagedStorage(dataDirectory, config.network);
  } catch (error) {
    throw new Error(`Kupo storage ${dataDirectory}: ${(error as Error).message}`, { cause: error });
  }

  options.signal.throwIfAborted();

  return [
    "--node-socket",
    resolve(options.nodeSocketPath),
    "--node-config",
    nodeConfigPath,
    "--workdir",
    dataDirectory,
    "--host",
    "0.0.0.0",
    "--port",
    "1442",
    ...settings.arguments,
  ];
}
