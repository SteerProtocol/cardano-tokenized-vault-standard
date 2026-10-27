import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { discoverPlugins } from "@ctvs/plugins/indexer";
import { afterEach, beforeEach, expect, it } from "vitest";
import { resolvePackages } from "../src/packages.js";
import {
  adapter,
  adapterSource,
  config,
  inspectPackages,
  network,
  registryFixture,
} from "./package-fixture.js";

let registry: Awaited<ReturnType<typeof registryFixture>>;
let stopped = false;

beforeEach(async () => {
  registry = await registryFixture();
  stopped = false;
});

afterEach(async () => {
  if (!stopped) await registry.close();

  await registry.remove();
});

function options(signal = new AbortController().signal) {
  return {
    cacheDirectory: join(registry.directory, "cache"),
    signal,
    registry: registry.url,
    bundled: {},
  };
}

async function snapshot() {
  const root = join(options().cacheDirectory, "installs");
  const entries = (await readdir(root)).filter((name) => !name.startsWith("."));

  expect(entries).toHaveLength(1);

  return join(root, entries[0] ?? "missing");
}

async function publishPlugin() {
  await registry.publish({ name: "@fixture/dependency", source: "export const value = 'first';" });
  await registry.publish({
    name: "@fixture/plugin",
    dependencies: { "@fixture/dependency": "^1.0.0" },
    source: `import { value } from '@fixture/dependency'; export { value }; ${adapterSource()}`,
  });
}

it("installs exact packages with import-only exports, locks transitives and discovers deployments", async () => {
  await publishPlugin();

  const input = config({ "@fixture/plugin": "1.0.0" }, ["@fixture/plugin", "@fixture/plugin"]);
  const importer = await resolvePackages(input, options());
  const module = (await importer("@fixture/plugin")) as { value: string };

  expect(module.value).toBe("first");
  expect(await importer("@fixture/plugin")).toBe(module);
  expect(
    await discoverPlugins(input.registrations, network, options().signal, importer),
  ).toHaveLength(2);

  const directory = await snapshot();
  const lock = JSON.parse(await readFile(join(directory, "package-lock.json"), "utf8"));

  expect(lock.packages["node_modules/@fixture/dependency"].version).toBe("1.0.0");
  expect(lock.packages["node_modules/@fixture/dependency"].integrity).toMatch(/^sha512-/);
  expect(lock.packages["node_modules/@fixture/plugin"].version).toBe("1.0.0");
  await registry.publish({
    name: "@fixture/dependency",
    version: "1.1.0",
    source: "export const value = 'later';",
  });

  const requests = registry.requests();
  const restarted = await resolvePackages(input, options());

  expect(((await restarted("@fixture/plugin")) as { value: string }).value).toBe("first");
  expect(registry.requests()).toBe(requests);
  await registry.close();
  stopped = true;

  const offline = await resolvePackages(input, options());

  expect(((await offline("@fixture/plugin")) as { value: string }).value).toBe("first");
  expect((await inspectPackages([input], options()))[0]).toMatchObject({
    module: { value: "first" },
    reused: true,
    discovered: [{ id: "vault-0" }, { id: "vault-1" }],
  });
}, 20_000);

it("disables lifecycle scripts and installs unused extras without importing or enabling them", async () => {
  const marker = join(registry.directory, "script-ran");
  const script = `node -e ${JSON.stringify(`require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`)}`;

  await registry.publish({ name: "@fixture/dependency", scripts: { postinstall: script } });
  await registry.publish({
    name: "@fixture/unused",
    source: "throw new Error('must not import');",
    dependencies: { "@fixture/dependency": "1.0.0" },
    scripts: { install: script },
  });

  const input = config({ "@fixture/unused": "1.0.0" });
  const settings = {
    ...options(),
    bundled: {
      "@fixture/plugin": { version: "1.0.0", load: async () => adapter() },
    },
  };
  const importer = await resolvePackages(input, settings);

  await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(importer("@fixture/unused")).rejects.toThrow("not registered");
  expect(
    await discoverPlugins(input.registrations, network, settings.signal, importer),
  ).toHaveLength(1);
  expect(await readdir(join(await snapshot(), "node_modules/@fixture"))).toEqual([
    "dependency",
    "unused",
  ]);
}, 20_000);

it("cleans failed installation staging and allows a later successful retry", async () => {
  const input = config({ "@fixture/plugin": "1.0.0" });

  await expect(resolvePackages(input, options())).rejects.toThrow("installation failed");
  expect(await readdir(join(options().cacheDirectory, "installs"))).toEqual([]);
  await registry.publish({ name: "@fixture/plugin" });

  const importer = await resolvePackages(input, options());

  expect(importer).toBeTypeOf("function");
  expect((await inspectPackages([input], options()))[0]?.module.discoveryPlugin.version).toBe(
    "1.0.0",
  );
}, 20_000);

it("cleans an interrupted install and ignores unpublished staging from a previous process", async () => {
  const controller = new AbortController();
  const settings = options(controller.signal);
  const staging = join(settings.cacheDirectory, "installs", ".stage-abandoned");

  await mkdir(staging, { recursive: true });
  await writeFile(join(staging, "package.json"), "{}");
  registry.pause();

  const pending = resolvePackages(config({ "@fixture/plugin": "1.0.0" }), settings);
  const rejected = expect(pending).rejects.toThrow("installation failed");

  await expect.poll(() => registry.requests()).toBeGreaterThan(0);
  controller.abort();
  await rejected;
  expect(await readdir(join(settings.cacheDirectory, "installs"))).toEqual([".stage-abandoned"]);
  registry.resume();
  await registry.publish({ name: "@fixture/plugin" });
  await resolvePackages(config({ "@fixture/plugin": "1.0.0" }), options());
  expect(await readdir(join(settings.cacheDirectory, "installs"))).toHaveLength(2);
}, 20_000);

it.each([
  "complete.json",
  "package-lock.json",
  "package.json",
  "import.mjs",
  "node_modules/@fixture/plugin/package.json",
  "node_modules/@fixture/dependency/package.json",
])(
  "refuses an incomplete published cache without a new registry resolution (%s)",
  async (file) => {
    await publishPlugin();

    const input = config({ "@fixture/plugin": "1.0.0" });

    await resolvePackages(input, options());

    const directory = await snapshot();

    await rm(join(directory, file));

    const requests = registry.requests();

    await expect(resolvePackages(input, options())).rejects.toThrow(
      "incomplete or changed package cache",
    );
    expect(registry.requests()).toBe(requests);
  },
  20_000,
);

it("does not re-resolve a descriptor that disagrees with its pinned package version", async () => {
  await registry.publish({
    name: "@fixture/plugin",
    source: adapterSource("@fixture/plugin", "2.0.0"),
  });

  const input = config({ "@fixture/plugin": "1.0.0" });

  await resolvePackages(input, options());
  await expect(inspectPackages([input], options())).rejects.toThrow("version mismatch");

  const requests = registry.requests();

  await expect(inspectPackages([input], options())).rejects.toThrow("version mismatch");
  expect(registry.requests()).toBe(requests);
}, 20_000);

it("verifies installed package name before importing", async () => {
  await registry.publish({ name: "@fixture/plugin" });

  const importer = await resolvePackages(config({ "@fixture/plugin": "1.0.0" }), options());
  const filename = join(await snapshot(), "node_modules/@fixture/plugin/package.json");
  const manifest = JSON.parse(await readFile(filename, "utf8"));

  await writeFile(filename, JSON.stringify({ ...manifest, name: "other" }));
  await expect(importer("@fixture/plugin")).rejects.toThrow("identity mismatch");
}, 20_000);

it("refuses changed cache metadata without resolving dependencies again", async () => {
  await publishPlugin();

  const input = config({ "@fixture/plugin": "1.0.0" });

  await resolvePackages(input, options());

  const directory = await snapshot();
  const lock = await readFile(join(directory, "package-lock.json"), "utf8");
  const record = await readFile(join(directory, "complete.json"), "utf8");
  const dependency = "node_modules/@fixture/dependency";
  const missingIntegrity = JSON.parse(lock);
  const wrongDependencies = JSON.parse(lock);
  const wrongVersion = JSON.parse(lock);
  const wrongLocation = JSON.parse(lock);

  delete missingIntegrity.packages[dependency].integrity;
  wrongDependencies.packages[""].dependencies = {};
  wrongVersion.packages[dependency].version = "9.0.0";
  wrongLocation.packages["node_modules/../../outside"] = wrongLocation.packages[dependency];

  const changes = [
    ["package-lock.json", `${lock}\n`],
    ["package-lock.json", JSON.stringify(missingIntegrity)],
    ["package-lock.json", JSON.stringify(wrongDependencies)],
    ["package-lock.json", JSON.stringify(wrongVersion)],
    ["package-lock.json", JSON.stringify(wrongLocation)],
    ["complete.json", JSON.stringify({ ...JSON.parse(record), format: 0 })],
    ["package.json", "{}"],
    ["import.mjs", "export const load = () => null;"],
  ] as const;
  const requests = registry.requests();

  for (const [file, content] of changes) {
    const filename = join(directory, file);
    const original = await readFile(filename, "utf8");

    await writeFile(filename, content);
    await expect(resolvePackages(input, options())).rejects.toThrow(
      "incomplete or changed package cache",
    );
    await writeFile(filename, original);
  }

  expect(registry.requests()).toBe(requests);
}, 20_000);

it("supports platform-skipped optional dependencies and detects loss of installed optional dependencies", async () => {
  await registry.publish({
    name: "@fixture/skipped",
    os: [process.platform === "linux" ? "darwin" : "linux"],
  });
  await registry.publish({ name: "@fixture/optional" });
  await registry.publish({
    name: "@fixture/plugin",
    optionalDependencies: {
      "@fixture/skipped": "1.0.0",
      "@fixture/optional": "1.0.0",
    },
  });

  const input = config({ "@fixture/plugin": "1.0.0" });

  await resolvePackages(input, options());
  await resolvePackages(input, options());

  const directory = await snapshot();

  await expect(
    readFile(join(directory, "node_modules/@fixture/skipped/package.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  await rm(join(directory, "node_modules/@fixture/optional"), { recursive: true });
  await expect(resolvePackages(input, options())).rejects.toThrow(
    "incomplete or changed package cache",
  );
}, 20_000);

it("publishes one complete snapshot for concurrent installers", async () => {
  await registry.publish({ name: "@fixture/plugin" });

  const input = config({ "@fixture/plugin": "1.0.0" });
  const importers = await Promise.all([
    resolvePackages(input, options()),
    resolvePackages(input, options()),
  ]);

  expect(importers.every((importer) => typeof importer === "function")).toBe(true);
  expect((await inspectPackages([input], options()))[0]?.module.discoveryPlugin.version).toBe(
    "1.0.0",
  );
  expect(await readdir(join(options().cacheDirectory, "installs"))).toHaveLength(1);
}, 20_000);

it("keeps changed exact pins in separate immutable installations", async () => {
  await registry.publish({ name: "@fixture/plugin" });
  await registry.publish({ name: "@fixture/plugin", version: "2.0.0" });

  const inputs = [config({ "@fixture/plugin": "1.0.0" }), config({ "@fixture/plugin": "2.0.0" })];
  const results = await inspectPackages(inputs, options());

  expect(results.map((result) => result.module.discoveryPlugin.version)).toEqual([
    "1.0.0",
    "2.0.0",
  ]);
  expect(await readdir(join(options().cacheDirectory, "installs"))).toHaveLength(2);
}, 20_000);

it("combines multiple packages and reuses their cache regardless of configuration order", async () => {
  await registry.publish({ name: "@fixture/one" });
  await registry.publish({ name: "other-plugin" });

  const names = ["@fixture/one", "other-plugin"];
  const first = config({ "other-plugin": "1.0.0", "@fixture/one": "1.0.0" }, names);
  const second = config({ "@fixture/one": "1.0.0", "other-plugin": "1.0.0" }, names);

  await resolvePackages(first, options());

  const requests = registry.requests();
  const results = await inspectPackages([second], options());

  expect(results[0]?.discovered).toHaveLength(2);
  expect(registry.requests()).toBe(requests);
  expect(await readdir(join(options().cacheDirectory, "installs"))).toHaveLength(1);
}, 20_000);

it("preserves an exact prerelease version", async () => {
  const version = "1.0.0-rc.1";

  await registry.publish({ name: "@fixture/plugin", version });

  const input = config({ "@fixture/plugin": version });
  const results = await inspectPackages([input], options());

  expect(results[0]?.module.discoveryPlugin.version).toBe(version);
}, 20_000);

it("rejects npm normalization of a build-metadata pin before publishing the installation", async () => {
  await registry.publish({ name: "@fixture/plugin", version: "1.0.0" });

  const input = config({ "@fixture/plugin": "1.0.0+build.7" });

  await expect(resolvePackages(input, options())).rejects.toThrow(
    "installed package identity mismatch",
  );
  expect(await readdir(join(options().cacheDirectory, "installs"))).toEqual([]);
}, 20_000);

it.each([
  "file:///tmp/registry",
  "https://user:secret@registry.invalid/",
  "https://registry.invalid/?token=x",
])("rejects unsupported registry options (%s)", async (url) => {
  await expect(
    resolvePackages(config({ "@fixture/plugin": "1.0.0" }), { ...options(), registry: url }),
  ).rejects.toThrow("package registry");
  expect(registry.requests()).toBe(0);
});
