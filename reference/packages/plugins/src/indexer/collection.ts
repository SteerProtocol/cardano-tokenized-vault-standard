/** Combine collection requirements while preserving each registration's replay and history needs. */
import {
  type CollectionMatch,
  type CollectionRule,
  collectionRule,
  type DiscoveredRegistration,
  type HistoryRequirement,
  type NetworkIdentity,
  networkIdentity,
  sameNetwork,
} from "../contract/discovery.js";

interface CollectionConsumer {
  registrationId: string;
  source: string;
  from: CollectionRule["from"];
  history: HistoryRequirement;
}

interface PlannedCollection {
  pattern: string;
  history: HistoryRequirement;
  consumers: CollectionConsumer[];
}

export interface CollectionPlan {
  network: NetworkIdentity;
  registrations: { id: string; package: string; version: string; ruleCount: number }[];
  collections: PlannedCollection[];
}

export function kupoPattern(match: CollectionMatch): string {
  switch (match.tag) {
    case "address":
      return match.val;
    case "payment-credential":
      return `${match.val}/*`;
    case "policy":
      return `${match.val}.*`;
    case "asset":
      return `${match.val.policyId}.${match.val.assetName}`;
  }
}

export function planCollections(
  network: NetworkIdentity,
  registrations: DiscoveredRegistration[],
): CollectionPlan {
  network = networkIdentity(network);

  const collections = new Map<string, PlannedCollection>();
  const ids = new Set<string>();

  for (const registration of registrations) {
    if (ids.has(registration.id) || !sameNetwork(network, registration.network))
      throw new Error("duplicate registration or incompatible collection network");

    ids.add(registration.id);

    for (const value of registration.rules) {
      const rule = collectionRule(value, network);
      const pattern = kupoPattern(rule.match);
      const entry = collections.get(pattern) ?? {
        pattern,
        history: rule.history,
        consumers: [],
      };
      const consumer = {
        registrationId: registration.id,
        source: rule.source,
        from: rule.from,
        history: rule.history,
      };

      if (rule.history === "spent-required") entry.history = "spent-required";

      if (
        !entry.consumers.some((existing) => JSON.stringify(existing) === JSON.stringify(consumer))
      )
        entry.consumers.push(consumer);

      collections.set(pattern, entry);
    }
  }

  return structuredClone({
    network,
    collections: [...collections.values()],
    registrations: registrations.map(({ id, package: name, version, rules }) => ({
      id,
      package: name,
      version,
      ruleCount: rules.length,
    })),
  });
}
