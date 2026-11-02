/** Local npm registry fixture: real tarballs and installs, with no public registry requests. */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { type KupoConfig, parseKupoConfig } from "../src/config.js";

export async function inspectPackages(
  configs: KupoConfig[],
  options: { cacheDirectory: string; registry: string },
) {
  const { stdout } = await promisify(execFile)(process.execPath, [
    "--import",
    "tsx",
    fileURLToPath(new URL("./native-packages.ts", import.meta.url)),
    JSON.stringify({ configs, options }),
  ]);

  return JSON.parse(stdout) as {
    module: { value?: string; discoveryPlugin: { version: string } };
    reused: boolean;
    discovered: unknown[];
  }[];
}

export const network = { networkId: 0, networkMagic: 42, genesisHash: "11".repeat(32) };

export function config(
  additionalPackages: Record<string, string> = {},
  names = ["@fixture/plugin"],
) {
  return parseKupoConfig({
    network,
    additionalPackages,
    registrations: names.map((name, index) => ({
      id: `vault-${index}`,
      package: name,
      deployment: {},
    })),
  });
}

export function adapter(name = "@fixture/plugin", version = "1.0.0") {
  return {
    discoveryPlugin: {
      apiVersion: "CTVS-DISCOVERY-PACKAGE-1",
      name,
      version,
      open: async (_deployment: unknown, network: unknown) => ({
        discover: () => ({ schema: "CTVS-DISCOVERY-1", network, rules: [] }),
      }),
    },
  };
}

export function adapterSource(name = "@fixture/plugin", version = "1.0.0") {
  return `export const discoveryPlugin = {
    apiVersion: "CTVS-DISCOVERY-PACKAGE-1", name: ${JSON.stringify(name)}, version: ${JSON.stringify(version)},
    open: async (_deployment, network) => ({ discover: () => ({ schema: "CTVS-DISCOVERY-1", network, rules: [] }) })
  };`;
}

interface FixturePackage {
  name: string;
  version?: string;
  source?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  os?: string[];
}

export async function registryFixture() {
  const directory = await mkdtemp(join(tmpdir(), "ctvs-package-registry-"));
  const packages = new Map<string, Record<string, unknown>>();
  const tarballs = new Map<string, Buffer>();
  const pending: ServerResponse[] = [];
  let requests = 0;
  let paused = false;
  const server = createServer((request, response) => {
    requests++;

    if (paused) {
      pending.push(response);

      return;
    }

    const path = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    const body = tarballs.get(path) ?? JSON.stringify(packages.get(path.slice(1)));

    response.writeHead(body ? 200 : 404, {
      "content-type": tarballs.has(path) ? "application/octet-stream" : "application/json",
    });
    response.end(body ?? "{}");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const address = server.address();

  if (!address || typeof address === "string") throw new Error("fixture registry failed to bind");

  const url = `http://127.0.0.1:${address.port}/`;

  async function publish(input: FixturePackage) {
    const version = input.version ?? "1.0.0";
    const identity = `${input.name.replaceAll("/", "-")}-${version}`;
    const root = join(directory, identity);
    const source = join(root, "package");
    const filename = join(root, "package.tgz");
    const manifest = { ...input, version, type: "module", exports: { import: "./index.js" } };

    await mkdir(source, { recursive: true });
    await writeFile(join(source, "package.json"), JSON.stringify(manifest));
    await writeFile(join(source, "index.js"), input.source ?? adapterSource(input.name, version));
    await promisify(execFile)("tar", ["-czf", filename, "-C", root, "package"]);

    const bytes = await readFile(filename);
    const path = `tarballs/${identity}.tgz`;
    const previous = packages.get(input.name);
    const versions = (previous?.versions ?? {}) as Record<string, unknown>;

    tarballs.set(`/${path}`, bytes);
    packages.set(input.name, {
      name: input.name,
      "dist-tags": { latest: version },
      versions: {
        ...versions,
        [version]: {
          ...manifest,
          dist: {
            tarball: new URL(path, url).href,
            integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
          },
        },
      },
    });
  }

  return {
    directory,
    url,
    publish,
    requests: () => requests,
    pause: () => {
      paused = true;
    },
    resume: () => {
      paused = false;
    },
    async close() {
      for (const response of pending) response.destroy();

      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
    remove: () => rm(directory, { recursive: true, force: true }),
  };
}
