import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverPlugins } from "@ctvs/plugins/indexer";
import { afterEach, expect, it, vi } from "vitest";
import { resolvePackages } from "../src/packages.js";
import { adapter, config, network } from "./package-fixture.js";

const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function options() {
  const directory = await mkdtemp(join(tmpdir(), "ctvs-bundled-packages-"));

  directories.push(directory);

  return {
    cacheDirectory: join(directory, "cache"),
    signal: new AbortController().signal,
    bundled: {},
  };
}

it("loads registered bundles lazily and once, opening a fresh session for each deployment", async () => {
  const module = adapter();
  const open = vi.spyOn(module.discoveryPlugin, "open");
  const load = vi.fn(async () => module);
  const unused = vi.fn();
  const settings = {
    ...(await options()),
    bundled: {
      "@fixture/plugin": { version: "1.0.0", load },
      "@fixture/unused": { version: "2.0.0", load: unused },
    },
  };
  const input = config({ "@fixture/plugin": "1.0.0" }, ["@fixture/plugin", "@fixture/plugin"]);
  const importer = await resolvePackages(input, settings);

  expect(load).not.toHaveBeenCalled();

  const discovered = await discoverPlugins(input.registrations, network, settings.signal, importer);

  expect(discovered.map(({ id, version }) => [id, version])).toEqual([
    ["vault-0", "1.0.0"],
    ["vault-1", "1.0.0"],
  ]);
  expect(load).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenCalledTimes(2);
  expect(unused).not.toHaveBeenCalled();
  await expect(importer("@fixture/unused")).rejects.toThrow("not registered");
  await expect(readdir(settings.cacheDirectory)).rejects.toMatchObject({ code: "ENOENT" });
});

it("rejects unavailable registrations and conflicting bundled versions before installation", async () => {
  const settings = {
    ...(await options()),
    bundled: {
      "@fixture/plugin": { version: "1.0.0", load: async () => adapter() },
    },
  };

  await expect(resolvePackages(config({}, ["@fixture/missing"]), settings)).rejects.toThrow(
    "unavailable",
  );
  await expect(resolvePackages(config({ "@fixture/plugin": "2.0.0" }), settings)).rejects.toThrow(
    "conflicts",
  );
  await expect(readdir(settings.cacheDirectory)).rejects.toMatchObject({ code: "ENOENT" });
});

it("compares bundled build metadata exactly without asking npm to resolve it", async () => {
  const version = "1.0.0+build.7";
  const settings = {
    ...(await options()),
    bundled: {
      "@fixture/plugin": { version, load: async () => adapter("@fixture/plugin", version) },
    },
  };
  const importer = await resolvePackages(config({ "@fixture/plugin": version }), settings);

  expect(await importer("@fixture/plugin")).toHaveProperty("discoveryPlugin.version", version);
  await expect(readdir(settings.cacheDirectory)).rejects.toMatchObject({ code: "ENOENT" });
});

it.each([
  {},
  { ...adapter().discoveryPlugin, apiVersion: "wrong" },
  { ...adapter().discoveryPlugin, name: "different" },
  { ...adapter().discoveryPlugin, open: undefined },
  { ...adapter().discoveryPlugin, version: "2.0.0" },
])("refuses incompatible bundle descriptors (%#)", async (discoveryPlugin) => {
  const settings = {
    ...(await options()),
    bundled: {
      "@fixture/plugin": { version: "1.0.0", load: async () => ({ discoveryPlugin }) },
    },
  };
  const importer = await resolvePackages(config(), settings);

  await expect(importer("@fixture/plugin")).rejects.toThrow();
});

it("keeps the importer connected to cancellation", async () => {
  const controller = new AbortController();
  const settings = {
    ...(await options()),
    signal: controller.signal,
    bundled: {
      "@fixture/plugin": { version: "1.0.0", load: async () => adapter() },
    },
  };
  const importer = await resolvePackages(config(), settings);

  await importer("@fixture/plugin");
  controller.abort();
  await expect(importer("@fixture/plugin")).rejects.toThrow();
  await expect(resolvePackages(config(), settings)).rejects.toThrow();
});

it("accepts the bundled workspace example through its published discovery entry point", async () => {
  const module = await import("@ctvs/example-plugin");
  const name = module.discoveryPlugin.name;
  const settings = {
    ...(await options()),
    bundled: {
      [name]: {
        version: module.discoveryPlugin.version,
        load: () => import("@ctvs/example-plugin"),
      },
    },
  };
  const input = config({}, [name]);
  const importer = await resolvePackages(input, settings);

  expect(await importer(name)).toBe(module);

  const filename = new URL("../config.example.json", import.meta.url);
  const example = JSON.parse(
    (await readFile(filename, "utf8"))
      .replaceAll("<sha256-of-original-shelley-genesis>", network.genesisHash)
      .replaceAll("<56-lowercase-hex-policy-id>", "22".repeat(28)),
  );

  if (!("Suspending" in WebAssembly && "promising" in WebAssembly)) {
    await expect(
      discoverPlugins(example.registrations, network, settings.signal, importer),
    ).rejects.toThrow("JSPI");

    return;
  }

  expect(
    await discoverPlugins(example.registrations, network, settings.signal, importer),
  ).toHaveLength(1);
});

it("does not let malformed input reach installation", async () => {
  const settings = await options();
  const input = config({ "@fixture/plugin": "1.0.0" });

  input.additionalPackages["@fixture/plugin"] = "^1.0.0";
  await expect(resolvePackages(input, settings)).rejects.toThrow("canonical exact versions");
});
