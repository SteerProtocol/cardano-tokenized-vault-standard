import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { exampleDeployment, manyRulesDeployment, network, rule } from "./fixtures/discovery.js";
import { component as componentUrl } from "./fixtures/guest.js";
import { discover } from "./fixtures/plugin.js";

const schema = "CTVS-DISCOVERY-1";

function expectFailure(operation, code) {
  assert.throws(operation, (error) => {
    assert.equal(error.payload.code, code);
    assert.equal(typeof error.payload.message, "string");
    assert.ok(error.payload.message.length > 0);

    return true;
  });
}

test("build emits a WebAssembly component", async () => {
  const component = await readFile(componentUrl);

  assert.deepEqual([...component.subarray(0, 8)], [0x00, 0x61, 0x73, 0x6d, 0x0d, 0x00, 0x01, 0x00]);
});

test("discovery preserves every match variant and collection requirement", () => {
  const config = exampleDeployment();
  const before = structuredClone(config);

  assert.deepEqual(discover(config, undefined, 256), {
    schema,
    network,
    rules: config.rules,
    nextCursor: undefined,
  });
  assert.deepEqual(config, before);
});

test("10,001 rules paginate without loss or duplication", () => {
  const config = manyRulesDeployment(10_001);
  const collected = [];
  let cursor;
  let pages = 0;

  do {
    const page = discover(config, cursor, 256);

    assert.equal(page.schema, schema);
    assert.deepEqual(page.network, network);
    assert.ok(page.rules.length > 0 && page.rules.length <= 256);
    collected.push(...page.rules);
    pages++;

    if (page.nextCursor !== undefined) {
      assert.equal(page.nextCursor, String(collected.length));
    }

    cursor = page.nextCursor;
    assert.ok(pages <= 40, "discovery must terminate");
  } while (cursor !== undefined);

  assert.equal(pages, 40);
  assert.deepEqual(collected, config.rules);
});

test("empty discovery does not imply wildcard collection", () => {
  assert.deepEqual(discover({ network, rules: [] }, undefined, 256), {
    schema,
    network,
    rules: [],
    nextCursor: undefined,
  });
});

test("different deployments do not share pagination state", () => {
  const first = {
    network,
    rules: [
      rule({ tag: "policy", val: "77".repeat(28) }),
      rule({ tag: "policy", val: "88".repeat(28) }),
    ],
  };
  const second = {
    network: { ...network, networkId: 1, networkMagic: 764824073 },
    rules: [rule({ tag: "policy", val: "99".repeat(28) })],
  };

  assert.equal(discover(first, undefined, 1).nextCursor, "1");
  assert.deepEqual(discover(second, undefined, 1), {
    schema,
    ...second,
    nextCursor: undefined,
  });
  assert.deepEqual(discover(first, "1", 1), {
    schema,
    network,
    rules: first.rules.slice(1),
    nextCursor: undefined,
  });
  assert.deepEqual(discover(first, undefined, 1).rules, first.rules.slice(0, 1));
});

test("invalid page sizes return structured discovery errors", () => {
  for (const pageSize of [0, 257, 0xffffffff]) {
    expectFailure(() => discover({ network, rules: [] }, undefined, pageSize), "invalid-page-size");
  }
});

test("malformed and out-of-range cursors return structured discovery errors", () => {
  const config = { network, rules: [rule({ tag: "policy", val: "aa".repeat(28) })] };

  for (const cursor of ["", "01", "+1", "-1", " 1", "1.0", "2", "18446744073709551616"]) {
    expectFailure(() => discover(config, cursor, 256), "invalid-cursor");
  }

  assert.deepEqual(discover(config, "1", 256).rules, []);
});

test("network ids other than 0 and 1 return a structured discovery error", () => {
  expectFailure(
    () => discover({ network: { ...network, networkId: 2 }, rules: [] }, undefined, 256),
    "invalid-network",
  );
});
