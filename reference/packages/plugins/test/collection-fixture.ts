/** Synthetic collection declarations and installed-package adapters. */

import type { CollectionRule, DiscoveryPackage } from "@ctvs/plugins/indexer";
import { credentialToAddress } from "@lucid-evolution/utils";

export const network = { networkId: 0, networkMagic: 42, genesisHash: "11".repeat(32) };
export const policy = "22".repeat(28);
export const credential = "33".repeat(28);
export const address = credentialToAddress("Preprod", { type: "Script", hash: credential });

export const signal = () => new AbortController().signal;

export function rule(extra: Partial<CollectionRule> = {}): CollectionRule {
  return {
    source: "positions",
    match: { tag: "policy", val: policy },
    from: { tag: "origin" },
    history: "spent-required",
    ...extra,
  };
}

export function registration(id = "a", rules = [rule()]) {
  return { id, package: `@fixture/${id}`, version: "1.0.0", network, rules };
}

export function packageFixture(name: string, page?: (cursor: string | undefined) => unknown) {
  const discoveryPlugin: DiscoveryPackage = {
    apiVersion: "CTVS-DISCOVERY-PACKAGE-1",
    name,
    version: "1.0.0",
    async open(deployment) {
      const rules = deployment.rules as CollectionRule[];

      return {
        discover(cursor, pageSize) {
          const offset = Number(cursor ?? "0");
          const next = offset + pageSize;

          return page
            ? page(cursor)
            : {
                schema: "CTVS-DISCOVERY-1",
                network,
                rules: rules.slice(offset, next),
                nextCursor: next < rules.length ? String(next) : undefined,
              };
        },
      };
    },
  };

  return { discoveryPlugin };
}
