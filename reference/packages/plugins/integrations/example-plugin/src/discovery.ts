/** Adapt the fixture's typed WIT input to the shared discovery host interface. */
import {
  collectionRule,
  type DiscoveryPackage,
  loadNodePlugin,
  networkIdentity,
  sameNetwork,
} from "@ctvs/plugins/indexer";
import { examplePlugin } from "./component.js";

export const discoveryPlugin: DiscoveryPackage = {
  apiVersion: "CTVS-DISCOVERY-PACKAGE-1",
  name: examplePlugin.name,
  version: examplePlugin.version,
  async open(raw, network, signal) {
    signal.throwIfAborted();

    if (!sameNetwork(networkIdentity(raw.network), network))
      throw new Error("plugin network does not match the configured network");

    if (!Array.isArray(raw.rules) || raw.rules.length > 16384)
      throw new Error("plugin discovery exceeds 16384 rules");

    const deployment = {
      network,
      rules: raw.rules.map((rule: unknown) => collectionRule(rule, network)),
    };
    const guest = await loadNodePlugin(examplePlugin, {
      "ctvs:example-plugin/http": {
        get: async () => {
          throw "http-disabled-during-discovery";
        },
      },
    });

    signal.throwIfAborted();

    return { discover: (cursor, pageSize) => guest.discover(deployment, cursor, pageSize) };
  },
};
