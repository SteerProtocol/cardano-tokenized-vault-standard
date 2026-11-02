/** Turn a validated collection plan into collection flags, preserving the shared reader by default. */
import type { CollectionPlan } from "@ctvs/plugins/indexer";

export type KupoProfile = "shared-reader" | "plugins-only";

export interface KupoSettings {
  readonly since: "origin";
  readonly spent: "retain";
  readonly patterns: readonly string[];
  readonly arguments: readonly string[];
}

export function kupoSettings(
  plan: CollectionPlan,
  profile: KupoProfile = "shared-reader",
): KupoSettings {
  if (profile !== "shared-reader" && profile !== "plugins-only")
    throw new Error("unsupported Kupo collection profile");

  const patterns =
    profile === "shared-reader"
      ? ["*"]
      : [...new Set(plan.collections.map((collection) => collection.pattern))].sort();

  if (patterns.length === 0) throw new Error("plugin-only Kupo requires at least one collection");

  return {
    since: "origin",
    spent: "retain",
    patterns,
    arguments: ["--since", "origin", ...patterns.flatMap((pattern) => ["--match", pattern])],
  };
}
