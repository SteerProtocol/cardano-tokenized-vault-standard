import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { prepareKupo } from "../src/startup.js";
import { registryFixture } from "./package-fixture.js";
import { startupFixture } from "./startup-fixture.js";

let fixture: Awaited<ReturnType<typeof startupFixture>>;

beforeEach(async () => {
  fixture = await startupFixture();
});

afterEach(async () => {
  await fixture.remove();
});

async function untouched() {
  await expect(readdir(fixture.options.dataDirectory)).rejects.toMatchObject({ code: "ENOENT" });
}

it("prepares all deployments before initializing storage and preserves argument boundaries", async () => {
  const open = vi.spyOn(fixture.plugin, "open");
  const load = vi.fn(async () => {
    await untouched();

    return { discoveryPlugin: fixture.plugin };
  });
  const args = await prepareKupo({
    ...fixture.options,
    bundled: { "@fixture/plugin": { version: "1.0.0", load } },
  });

  expect(load).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenCalledTimes(2);
  expect(args).toEqual([
    "--node-socket",
    fixture.options.nodeSocketPath,
    "--node-config",
    fixture.options.nodeConfigPath,
    "--workdir",
    fixture.options.dataDirectory,
    "--host",
    "0.0.0.0",
    "--port",
    "1442",
    "--since",
    "origin",
    "--match",
    "*",
  ]);
  expect(await readdir(fixture.options.dataDirectory)).toEqual([".ctvs-kupo.json"]);
});

it("rereads configuration on restart and combines changed plugin-only requirements", async () => {
  const first = await prepareKupo({ ...fixture.options, profile: "plugins-only" });
  const markerPath = join(fixture.options.dataDirectory, ".ctvs-kupo.json");
  const marker = await readFile(markerPath);

  fixture.input.registrations.push({
    id: "new-source",
    package: "@fixture/plugin",
    deployment: {
      rules: [
        {
          source: "other",
          match: { tag: "policy", val: "33".repeat(28) },
          from: { tag: "origin" },
          history: "unspent-sufficient",
        },
      ],
    },
  });
  await fixture.save();

  const restarted = await prepareKupo({ ...fixture.options, profile: "plugins-only" });

  expect(first.slice(-4)).toEqual(["--since", "origin", "--match", `${"22".repeat(28)}.*`]);
  expect(restarted.slice(-6)).toEqual([
    "--since",
    "origin",
    "--match",
    `${"22".repeat(28)}.*`,
    "--match",
    `${"33".repeat(28)}.*`,
  ]);
  expect(await readFile(markerPath)).toEqual(marker);
});

it("refuses malformed configuration before importing a plugin or creating storage", async () => {
  const load = vi.spyOn(fixture.options.bundled["@fixture/plugin"], "load");

  await writeFile(fixture.options.configPath, "{}");
  await expect(prepareKupo(fixture.options)).rejects.toThrow();
  expect(load).not.toHaveBeenCalled();
  await untouched();
});

it.each(["hash", "magic", "networkId", "missing-path", "invalid-node"])(
  "refuses a mounted node configuration mismatch before discovery (%s)",
  async (kind) => {
    const load = vi.spyOn(fixture.options.bundled["@fixture/plugin"], "load");

    if (kind === "hash") fixture.input.network.genesisHash = "00".repeat(32);
    else if (kind === "magic") fixture.input.network.networkMagic++;
    else if (kind === "networkId") fixture.input.network.networkId = 1;
    else await writeFile(fixture.options.nodeConfigPath, kind === "invalid-node" ? "{" : "{}");

    await fixture.save();
    await expect(prepareKupo(fixture.options)).rejects.toThrow();
    expect(load).not.toHaveBeenCalled();
    await untouched();
  },
);

it("accepts a matching mainnet declaration and an absolute genesis path", async () => {
  const genesis = JSON.stringify({ ...fixture.genesis, networkId: "Mainnet" });

  await writeFile(fixture.genesisPath, genesis);
  await writeFile(
    fixture.options.nodeConfigPath,
    JSON.stringify({ ShelleyGenesisFile: fixture.genesisPath }),
  );
  fixture.input.network.networkId = 1;
  fixture.input.network.genesisHash = createHash("sha256").update(genesis).digest("hex");
  await fixture.save();
  expect(await prepareKupo(fixture.options)).toContain("*");
});

it("does not initialize storage when a registered package is unavailable", async () => {
  await expect(prepareKupo({ ...fixture.options, bundled: {} })).rejects.toThrow("unavailable");
  await untouched();
});

it("does not initialize storage when package installation fails", async () => {
  const registry = await registryFixture();

  try {
    fixture.input.additionalPackages = { "@fixture/plugin": "1.0.0" };
    await fixture.save();
    await expect(
      prepareKupo({ ...fixture.options, bundled: {}, registry: registry.url }),
    ).rejects.toThrow("installation failed");
    await untouched();
  } finally {
    await registry.close();
    await registry.remove();
  }
}, 20_000);

it("does not initialize storage when a later deployment returns invalid discovery", async () => {
  fixture.input.registrations.push({
    id: "invalid",
    package: "@fixture/plugin",
    deployment: { rules: [{ match: "bad" }] },
  });
  await fixture.save();
  await expect(prepareKupo(fixture.options)).rejects.toThrow();
  await untouched();
});

it("cancels discovery without creating managed storage", async () => {
  const controller = new AbortController();
  const open = fixture.plugin.open;

  vi.spyOn(fixture.plugin, "open").mockImplementation(async (...args) => {
    controller.abort(new Error("cancelled discovery"));

    return open(...args);
  });
  await expect(prepareKupo({ ...fixture.options, signal: controller.signal })).rejects.toThrow(
    "cancelled discovery",
  );
  await untouched();
});

it("rejects already cancelled preparation before reading configuration", async () => {
  const signal = AbortSignal.abort(new Error("already cancelled"));

  await expect(prepareKupo({ ...fixture.options, configPath: "/missing", signal })).rejects.toThrow(
    "already cancelled",
  );
  await untouched();
});

it("preserves unrecognized storage and reports its path", async () => {
  await mkdir(fixture.options.dataDirectory);
  await writeFile(join(fixture.options.dataDirectory, "kupo.sqlite3"), "existing");
  await expect(prepareKupo(fixture.options)).rejects.toThrow(
    `Kupo storage ${fixture.options.dataDirectory}: unrecognized Kupo storage`,
  );
  expect(await readdir(fixture.options.dataDirectory)).toEqual(["kupo.sqlite3"]);
  expect(await readFile(join(fixture.options.dataDirectory, "kupo.sqlite3"), "utf8")).toBe(
    "existing",
  );
});

it("reuses an installed package offline through the complete preparation sequence", async () => {
  const registry = await registryFixture();
  let stopped = false;

  try {
    await registry.publish({
      name: "@fixture/plugin",
      source: `export const discoveryPlugin = {
        apiVersion: "CTVS-DISCOVERY-PACKAGE-1", name: "@fixture/plugin", version: "1.0.0",
        open: async (deployment, network) => ({
          discover: () => ({ schema: "CTVS-DISCOVERY-1", network, rules: deployment.rules })
        })
      };`,
    });
    fixture.input.additionalPackages = { "@fixture/plugin": "1.0.0" };
    await fixture.save();

    const options = { ...fixture.options, bundled: {}, registry: registry.url };
    const first = await prepareKupo(options);
    const requests = registry.requests();

    await registry.close();
    stopped = true;
    expect(await prepareKupo(options)).toEqual(first);
    expect(registry.requests()).toBe(requests);
  } finally {
    if (!stopped) await registry.close();

    await registry.remove();
  }
}, 20_000);
