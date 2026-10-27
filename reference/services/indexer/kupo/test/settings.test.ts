import { type CollectionRule, planCollections } from "@ctvs/plugins/indexer";
import { credentialToAddress } from "@lucid-evolution/utils";
import { expect, it } from "vitest";
import { type KupoProfile, kupoSettings } from "../src/settings.js";

const network = { networkId: 0, networkMagic: 42, genesisHash: "11".repeat(32) };
const policy = "22".repeat(28);
const credential = "33".repeat(28);
const address = credentialToAddress("Preprod", { type: "Script", hash: credential });

function rule(extra: Partial<CollectionRule> = {}): CollectionRule {
  return {
    source: "fixture",
    match: { tag: "policy", val: policy },
    from: { tag: "origin" },
    history: "spent-required",
    ...extra,
  };
}

function registration(id = "first", rules = [rule()]) {
  return { id, package: "@fixture/plugin", version: "1.0.0", network, rules };
}

it("defaults to the reader's exact origin/wildcard/retained-history contract", () => {
  const plan = planCollections(network, [registration()]);

  expect(kupoSettings(plan)).toEqual({
    since: "origin",
    spent: "retain",
    patterns: ["*"],
    arguments: ["--since", "origin", "--match", "*"],
  });
  expect(kupoSettings(plan, "shared-reader")).toEqual(kupoSettings(plan));
});

it("emits each supported plugin matcher as a separate literal argument", () => {
  const plan = planCollections(network, [
    registration("first", [
      rule(),
      rule({ match: { tag: "address", val: address } }),
      rule({ match: { tag: "payment-credential", val: credential } }),
      rule({ match: { tag: "asset", val: { policyId: policy, assetName: "" } } }),
      rule({ match: { tag: "asset", val: { policyId: policy, assetName: "abcd" } } }),
    ]),
  ]);

  expect(kupoSettings(plan, "plugins-only")).toEqual({
    since: "origin",
    spent: "retain",
    patterns: [`${policy}.`, `${policy}.*`, `${policy}.abcd`, `${credential}/*`, address],
    arguments: [
      "--since",
      "origin",
      "--match",
      `${policy}.`,
      "--match",
      `${policy}.*`,
      "--match",
      `${policy}.abcd`,
      "--match",
      `${credential}/*`,
      "--match",
      address,
    ],
  });
});

it("has deterministic output regardless of registration and rule order", () => {
  const first = registration("first", [rule(), rule({ match: { tag: "address", val: address } })]);
  const second = registration("second", [
    rule({ match: { tag: "payment-credential", val: credential } }),
  ]);
  const forward = planCollections(network, [first, second]);
  const backward = planCollections(network, [
    second,
    { ...first, rules: [...first.rules].reverse() },
  ]);

  expect(kupoSettings(forward, "plugins-only")).toEqual(kupoSettings(backward, "plugins-only"));
  expect(kupoSettings(forward)).toEqual(kupoSettings(backward));
});

it("preserves shared consumers and overlapping matchers without mutating the plan", () => {
  const plan = planCollections(network, [
    registration(),
    registration("second", [rule({ history: "unspent-sufficient" })]),
    registration("third", [
      rule({ match: { tag: "asset", val: { policyId: policy, assetName: "" } } }),
    ]),
  ]);
  const before = structuredClone(plan);

  expect(kupoSettings(plan, "plugins-only").patterns).toEqual([`${policy}.`, `${policy}.*`]);
  expect(plan).toEqual(before);
  expect(plan.collections.find((entry) => entry.pattern === `${policy}.*`)?.consumers).toHaveLength(
    2,
  );
});

it("starts from origin even when all consumers declare later or conflicting fork points", () => {
  const points = ["44", "55"].map((value) => ({
    tag: "point" as const,
    val: { slot: "18446744073709551615", blockHash: value.repeat(32) },
  }));
  const plan = planCollections(
    network,
    points.map((from, index) => registration(`vault-${index}`, [rule({ from })])),
  );
  const before = structuredClone(plan);

  expect(kupoSettings(plan, "plugins-only").since).toBe("origin");
  expect(kupoSettings(plan).since).toBe("origin");
  expect(plan).toEqual(before);
});

it.each(["spent-required", "unspent-sufficient"] as const)(
  "retains spent outputs for the initial profile even when the minimum is %s",
  (history) => {
    const plan = planCollections(network, [registration("first", [rule({ history })])]);

    for (const profile of ["shared-reader", "plugins-only"] as const) {
      const settings = kupoSettings(plan, profile);

      expect(settings.spent).toBe("retain");
      expect(settings.arguments).not.toContain("--prune-utxo");
      expect(settings.arguments).not.toContain("--defer-db-indexes");
    }
  },
);

it("removes only collections whose last consumer disappeared", () => {
  const first = registration();
  const second = registration("second", [
    rule(),
    rule({ match: { tag: "address", val: address } }),
  ]);
  const combined = planCollections(network, [first, second]);
  const remaining = planCollections(network, [first]);

  expect(kupoSettings(combined, "plugins-only").patterns).toEqual([`${policy}.*`, address]);
  expect(kupoSettings(remaining, "plugins-only").patterns).toEqual([`${policy}.*`]);
  expect(kupoSettings(combined)).toEqual(kupoSettings(remaining));
});

it.each([{ registrations: [] }, { registrations: [registration("empty", [])] }])(
  "requires explicit plugin collection instead of an empty-match fallback (%#)",
  ({ registrations }) => {
    const plan = planCollections(network, registrations);

    expect(() => kupoSettings(plan, "plugins-only")).toThrow("at least one collection");
    expect(kupoSettings(plan).patterns).toEqual(["*"]);
  },
);

it("does not impose a pattern-count limit", () => {
  const rules = Array.from({ length: 32 }, (_, index) =>
    rule({
      match: { tag: "policy", val: index.toString(16).padStart(56, "0") },
    }),
  );
  const plan = planCollections(network, [registration("many", rules)]);
  const settings = kupoSettings(plan, "plugins-only");

  expect(settings.patterns).toHaveLength(32);
  expect(settings.arguments.filter((value) => value === "--match")).toHaveLength(32);
});

it("rejects an unsupported host profile", () => {
  const plan = planCollections(network, [registration()]);

  expect(() => kupoSettings(plan, "unknown" as KupoProfile)).toThrow(
    "unsupported Kupo collection profile",
  );
});
