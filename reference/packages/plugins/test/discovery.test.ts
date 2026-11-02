import {
  collectionRule,
  discoverPlugins,
  networkIdentity,
  pluginRegistrations,
} from "@ctvs/plugins/indexer";
import { credentialToAddress } from "@lucid-evolution/utils";
import { expect, it, vi } from "vitest";
import { address, network, packageFixture, policy, rule, signal } from "./collection-fixture.js";

it("loads two packages and multiple deployments without merging registration-local source names", async () => {
  const importer = vi.fn(async (name: string) => packageFixture(name));
  const registrations = ["one", "two", "three"].map((id, index) => ({
    id,
    package: index === 2 ? "@fixture/b" : "@fixture/a",
    deployment: { rules: Array.from({ length: 257 }, () => rule()) },
  }));
  const discovered = await discoverPlugins(registrations, network, signal(), importer);

  expect(importer.mock.calls.flat()).toEqual(["@fixture/a", "@fixture/b"]);
  expect(discovered.map(({ id, rules }) => [id, rules.length])).toEqual([
    ["one", 257],
    ["two", 257],
    ["three", 257],
  ]);

  const first = registrations[0];

  if (!first) throw new Error("missing fixture registration");

  first.deployment.rules.length = 0;
  expect(discovered[0]?.rules).toHaveLength(257);
});

it("discovers more than 16 deployments while importing their shared package once", async () => {
  const importer = vi.fn(async (name: string) => packageFixture(name));
  const registrations = Array.from({ length: 32 }, (_, index) => ({
    id: `deployment-${index}`,
    package: "@fixture/shared",
    deployment: { rules: [rule({ source: `source-${index}` })] },
  }));
  const discovered = await discoverPlugins(registrations, network, signal(), importer);

  expect(importer.mock.calls.flat()).toEqual(["@fixture/shared"]);
  expect(discovered.map(({ id, rules }) => [id, rules[0]?.source])).toEqual(
    registrations.map(({ id, deployment }) => [id, deployment.rules[0]?.source]),
  );
});

it("keeps an empty terminal page empty and never imports disabled plugins", async () => {
  const importer = vi.fn(async (name: string) => packageFixture(name));

  expect(await discoverPlugins(undefined, network, signal(), importer)).toEqual([]);
  expect(importer).not.toHaveBeenCalled();
  expect(
    (
      await discoverPlugins(
        [{ id: "a", package: "fixture", deployment: { rules: [] } }],
        network,
        signal(),
        importer,
      )
    )[0]?.rules,
  ).toEqual([]);
});

it.each([
  null,
  {},
  { schema: "wrong", network, rules: [] },
  { schema: "CTVS-DISCOVERY-1", network: { ...network, networkMagic: 43 }, rules: [] },
  { schema: "CTVS-DISCOVERY-1", network, rules: Array(257).fill(rule()) },
  { schema: "CTVS-DISCOVERY-1", network, rules: [], nextCursor: "" },
  { schema: "CTVS-DISCOVERY-1", network, rules: [], nextCursor: "x" },
  { schema: "CTVS-DISCOVERY-1", network, rules: [], nextCursor: "x".repeat(1025) },
])("rejects malformed pages and repeated cursors (%#)", async (page) => {
  await expect(
    discoverPlugins(
      [{ id: "a", package: "fixture", deployment: {} }],
      network,
      signal(),
      async () => packageFixture("fixture", () => page),
    ),
  ).rejects.toThrow();
});

it("bounds endless pagination and discovery bytes", async () => {
  let cursor = 0;
  const enabled = [{ id: "a", package: "fixture", deployment: {} }];

  await expect(
    discoverPlugins(enabled, network, signal(), async () =>
      packageFixture("fixture", () => ({
        schema: "CTVS-DISCOVERY-1",
        network,
        rules: [],
        nextCursor: String(++cursor),
      })),
    ),
  ).rejects.toThrow("64 pages");
  await expect(
    discoverPlugins(enabled, network, signal(), async () =>
      packageFixture("fixture", () => ({
        schema: "CTVS-DISCOVERY-1",
        network,
        rules: [],
        padding: "x".repeat(16_777_216),
      })),
    ),
  ).rejects.toThrow("byte budget");
});

it("rejects incompatible package descriptors, missing exports and caller cancellation", async () => {
  const enabled = [{ id: "a", package: "fixture", deployment: {} }];

  for (const module of [{}, { discoveryPlugin: {} }, packageFixture("another")])
    await expect(discoverPlugins(enabled, network, signal(), async () => module)).rejects.toThrow();

  const fixture = packageFixture("fixture");

  fixture.discoveryPlugin.open = async () => ({}) as never;
  await expect(discoverPlugins(enabled, network, signal(), async () => fixture)).rejects.toThrow(
    "missing discovery",
  );
  await expect(discoverPlugins(enabled, network, AbortSignal.abort())).rejects.toThrow();
});

it("validates installed names, deployment sizes and unique registration identities", () => {
  for (const value of [
    null,
    {},
    [{ id: "a", package: "file:///plugin", deployment: {} }],
    [{ id: "a", package: "fixture", deployment: null }],
    [{ id: "a", package: "fixture", deployment: { text: "x".repeat(1_048_576) } }],
    [
      { id: "a", package: "fixture", deployment: {} },
      { id: "a", package: "fixture", deployment: {} },
    ],
  ])
    expect(() => pluginRegistrations(value)).toThrow();

  expect(() => networkIdentity({ ...network, networkId: 2 })).toThrow();
});

it("validates match types, point encodings and minimum history without requiring a pool", () => {
  expect(collectionRule(rule({ match: { tag: "address", val: address } }), network).match).toEqual({
    tag: "address",
    val: address,
  });
  expect(
    collectionRule(
      rule({
        from: { tag: "point", val: { slot: "9007199254740993", blockHash: "ab".repeat(32) } },
      }),
      network,
    ).from.tag,
  ).toBe("point");

  const invalid = [
    { source: "" },
    { history: "latest" },
    { match: { tag: "unknown" } },
    { match: { tag: "policy", val: policy.toUpperCase().replaceAll("2", "A") } },
    { match: { tag: "asset", val: { policyId: policy, assetName: "f" } } },
    {
      match: {
        tag: "address",
        val: credentialToAddress("Mainnet", { type: "Script", hash: policy }),
      },
    },
    { from: { tag: "point", val: { slot: "01", blockHash: "11".repeat(32) } } },
    { from: { tag: "point", val: { slot: "18446744073709551616", blockHash: "11".repeat(32) } } },
    { from: { tag: "elsewhere" } },
  ];

  for (const change of invalid)
    expect(() => collectionRule({ ...rule(), ...change }, network)).toThrow();
});
