/** Real component discovery and Kupo planning stay independent of the indexer service. */
import { discoverPlugins, planCollections } from "@ctvs/plugins/indexer";
import { expect, it } from "vitest";
import { network, rule, signal } from "./collection-fixture.js";

it("discovers workspace WASM deployments and combines their Kupo collection requirements", async () => {
  const module = await import("@ctvs/example-plugin");
  const deployment = { network, rules: Array.from({ length: 257 }, () => rule()) };
  const registrations = [
    { id: "first", package: "@ctvs/example-plugin", deployment },
    { id: "second", package: "@ctvs/example-plugin", deployment },
    { id: "third", package: "@fixture/another", deployment },
  ];
  const pending = discoverPlugins(registrations, network, signal(), async (name) =>
    name === "@ctvs/example-plugin"
      ? module
      : { discoveryPlugin: { ...module.discoveryPlugin, name: "@fixture/another" } },
  );

  if (!("Suspending" in WebAssembly && "promising" in WebAssembly)) {
    await expect(pending).rejects.toThrow("requires native JSPI");

    return;
  }

  const plan = planCollections(network, await pending);

  expect(plan.registrations.map(({ id, ruleCount }) => [id, ruleCount])).toEqual([
    ["first", 257],
    ["second", 257],
    ["third", 257],
  ]);
  expect(plan.collections).toHaveLength(1);
  expect(plan.collections[0]?.consumers.map(({ registrationId }) => registrationId)).toEqual([
    "first",
    "second",
    "third",
  ]);
});
