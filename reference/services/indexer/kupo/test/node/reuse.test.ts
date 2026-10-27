import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planCollections } from "@ctvs/plugins/indexer";
import { afterEach, beforeEach, expect, it } from "vitest";
import { Cleanup } from "../../../test/support/cleanup.js";
import { prepareManagedStorage } from "../../src/managed-storage.js";
import { kupoSettings } from "../../src/settings.js";
import { docker, image, seed, snapshot, startKupo, until } from "./kupo-fixture.js";

const network = { networkId: 0, networkMagic: 42, genesisHash: "11".repeat(32) };
const settings = kupoSettings(planCollections(network, []));
let cleanup: Cleanup;

beforeEach(() => {
  cleanup = new Cleanup();
});

afterEach(async () => {
  await cleanup.close();
});

async function directory() {
  const data = await mkdtemp(join(tmpdir(), "ctvs-kupo-native-"));

  cleanup.defer(() => rm(data, { recursive: true, force: true }));

  return data;
}

async function initialize(data: string, args = settings.arguments) {
  const kupo = await startKupo(data, args, cleanup);

  await kupo.initialized();
  await kupo.stop();
}

function selectiveSettings() {
  const plan = planCollections(network, [
    {
      id: "fixture",
      package: "@fixture/plugin",
      version: "1.0.0",
      network,
      rules: [
        {
          source: "fixture",
          match: { tag: "policy", val: "22".repeat(28) },
          from: { tag: "origin" },
          history: "spent-required",
        },
      ],
    },
  ]);

  return kupoSettings(plan, "plugins-only");
}

it("initializes fresh managed storage using the pinned Kupo schema and generated settings", async () => {
  const data = await directory();

  expect(
    await docker(["run", "--rm", "--pull=never", "--network", "none", image, "--version"]),
  ).toBe("v2.12.0+491918");
  expect(await prepareManagedStorage(data, network)).toBe("initialized");
  await initialize(data);
  expect(snapshot(data)).toEqual({
    version: 10,
    patterns: [{ pattern: "*" }],
    checkpoints: [],
    inputs: [],
  });
  expect(await prepareManagedStorage(data, network)).toBe("reused");
});

it("initializes and restarts with the same generated plugin-only patterns", async () => {
  const data = await directory();
  const selected = selectiveSettings();

  await prepareManagedStorage(data, network);
  await initialize(data, selected.arguments);

  const before = snapshot(data);

  expect(before.patterns).toEqual([{ pattern: `${"22".repeat(28)}.*` }]);
  expect(await prepareManagedStorage(data, network)).toBe("reused");
  await initialize(data, selected.arguments);
  expect(snapshot(data)).toEqual(before);
});

it("uses persisted checkpoints at startup despite --since origin and retains spent rows", async () => {
  const data = await directory();

  await prepareManagedStorage(data, network);
  await initialize(data);
  seed(data);

  const before = snapshot(data);
  const marker = await readFile(join(data, ".ctvs-kupo.json"));

  expect(await prepareManagedStorage(data, network)).toBe("reused");

  const kupo = await startKupo(data, settings.arguments, cleanup);

  await kupo.initialized();
  await kupo.collected();
  expect(await kupo.logs()).toContain('"slots":[1000000]');
  expect(await kupo.logs()).not.toContain('"DatabaseCreateNew"');
  expect(await kupo.logs()).not.toContain('"pruning":"inputs"');
  expect(snapshot(data)).toEqual(before);
  expect(before.inputs.map((row) => row.spent_at)).toEqual([2, null]);
  expect(await readFile(join(data, ".ctvs-kupo.json"))).toEqual(marker);
});

it("surfaces Kupo's native pattern-conflict refusal without changing persisted patterns or data", async () => {
  const data = await directory();

  await prepareManagedStorage(data, network);
  await initialize(data);
  seed(data);

  const before = snapshot(data);

  expect(await prepareManagedStorage(data, network)).toBe("reused");

  const kupo = await startKupo(data, selectiveSettings().arguments, cleanup);

  const code = await until(kupo.exited, "native pattern-conflict refusal");
  const output = await kupo.logs();

  expect(code).not.toBe(0);
  expect(output).toContain("Configuration patterns are different from previously known patterns");
  await expect(kupo.collected()).rejects.toThrow(`Kupo exited (${code}): ${output}`);
  expect(snapshot(data)).toEqual(before);
});

it("does not restore pruned history when pruning is disabled or origin is supplied again", async () => {
  const data = await directory();

  // This deliberately unmanaged negative control never receives the wrapper's ownership marker.
  await initialize(data);
  seed(data);

  const before = snapshot(data);
  const pruning = await startKupo(data, [...settings.arguments, "--prune-utxo"], cleanup);

  await pruning.initialized();
  await pruning.collected();
  expect(snapshot(data).inputs.map((row) => row.spent_at)).toEqual([null]);
  expect(await pruning.logs()).toContain('"pruning":"inputs"');
  await pruning.stop();

  const retained = await startKupo(data, settings.arguments, cleanup);

  await retained.initialized();
  await retained.collected();
  expect(snapshot(data).inputs.map((row) => row.spent_at)).toEqual([null]);
  expect(snapshot(data).checkpoints).toEqual(before.checkpoints);
  await expect(prepareManagedStorage(data, network)).rejects.toThrow("fresh empty directory");
  expect(snapshot(data).inputs.map((row) => row.spent_at)).toEqual([null]);
});
