import { kupoPattern, planCollections } from "@ctvs/plugins/indexer";
import { expect, it } from "vitest";
import { address, credential, network, policy, registration, rule } from "./collection-fixture.js";

it("shares identical matchers, strengthens history and preserves consumer starts and identities", () => {
  const plan = planCollections(network, [
    registration("a", [rule({ history: "unspent-sufficient" })]),
    registration("b", [
      rule({ from: { tag: "point", val: { slot: "1", blockHash: "11".repeat(32) } } }),
    ]),
  ]);

  expect(plan.collections).toHaveLength(1);
  expect(plan.collections[0]).toMatchObject({ pattern: `${policy}.*`, history: "spent-required" });
  expect(plan.collections[0]?.consumers.map((consumer) => consumer.registrationId)).toEqual([
    "a",
    "b",
  ]);
});

it("keeps different matchers separate and does not let removal weaken another consumer", () => {
  const first = registration("a", [
    rule(),
    rule(),
    rule({ match: { tag: "address", val: address } }),
  ]);
  const second = registration("b", [rule({ history: "unspent-sufficient" })]);
  const combined = planCollections(network, [first, second]);
  const remaining = planCollections(network, [first]);

  expect(combined.collections).toHaveLength(2);
  expect(combined.collections[0]?.consumers).toHaveLength(2);
  expect(remaining.collections[0]?.history).toBe("spent-required");
  expect(remaining.collections[0]?.consumers).toHaveLength(1);
  expect(() => planCollections(network, [first, first])).toThrow();
  expect(() => planCollections({ ...network, networkMagic: 43 }, [first])).toThrow();
});

it("encodes exactly the supported Kupo matchers, including an empty asset name", () => {
  expect(kupoPattern({ tag: "address", val: address })).toBe(address);
  expect(kupoPattern({ tag: "payment-credential", val: credential })).toBe(`${credential}/*`);
  expect(kupoPattern({ tag: "asset", val: { policyId: policy, assetName: "" } })).toBe(
    `${policy}.`,
  );
});
