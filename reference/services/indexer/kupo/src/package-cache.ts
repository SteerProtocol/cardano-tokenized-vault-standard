/** Publish complete npm installations atomically; reuse their locked dependency trees. */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { arch, platform } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { pluginPackageName } from "@ctvs/plugins/indexer";

const execute = promisify(execFile);
const format = 1;
const resolver = "export const load = (name) => import(name);\n";

interface CacheOptions {
  cacheDirectory: string;
  signal: AbortSignal;
  registry?: string;
}

interface Lockfile {
  lockfileVersion: number;
  packages: Record<
    string,
    {
      version?: string;
      integrity?: string;
      optional?: boolean;
      dependencies?: Record<string, string>;
    }
  >;
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function validateLocation(location: string) {
  const prefix = "node_modules/";

  if (!location.startsWith(prefix)) throw new Error("invalid installed package location");

  for (const name of location.slice(prefix.length).split("/node_modules/")) pluginPackageName(name);
}

function registryUrl(value = "https://registry.npmjs.org/") {
  const url = new URL(value);

  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "package registry must be an HTTP(S) URL without credentials, query or fragment",
    );

  return url.href;
}

async function exists(directory: string) {
  try {
    await stat(directory);

    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;

    return false;
  }
}

async function installedVersion(directory: string, location: string, optional: boolean) {
  try {
    return JSON.parse(await readFile(join(directory, location, "package.json"), "utf8")).version;
  } catch (error) {
    if (!optional || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;

    return undefined;
  }
}

export async function checkInstalledIdentity(directory: string, name: string, version: string) {
  const manifest = JSON.parse(
    await readFile(join(directory, "node_modules", name, "package.json"), "utf8"),
  );

  if (manifest.name !== name || manifest.version !== version)
    throw new Error(`installed package identity mismatch: ${name}`);
}

async function validateTree(directory: string, manifest: string) {
  if ((await readFile(join(directory, "package.json"), "utf8")) !== manifest)
    throw new Error("installation manifest changed");

  const lockText = await readFile(join(directory, "package-lock.json"), "utf8");
  const lock = JSON.parse(lockText) as Lockfile;
  const dependencies = JSON.parse(manifest).dependencies as Record<string, string>;
  const installed: [string, string][] = [];

  if (
    lock.lockfileVersion !== 3 ||
    JSON.stringify(lock.packages[""]?.dependencies) !== JSON.stringify(dependencies)
  )
    throw new Error("installation lock does not match requested packages");

  for (const [name, version] of Object.entries(dependencies))
    await checkInstalledIdentity(directory, name, version);

  for (const [location, entry] of Object.entries(lock.packages)) {
    if (location === "") continue;

    validateLocation(location);

    if (!entry.integrity || !entry.version)
      throw new Error("installation lock contains an unverified package");

    const version = await installedVersion(directory, location, entry.optional === true);

    if (version === undefined && entry.optional) continue;

    if (version !== entry.version) throw new Error("installed dependency version changed");

    installed.push([location, version]);
  }

  return { lockHash: digest(lockText), treeHash: digest(JSON.stringify(installed)) };
}

async function validateSnapshot(directory: string, manifest: string, key: string) {
  try {
    const record = JSON.parse(await readFile(join(directory, "complete.json"), "utf8"));
    const { lockHash, treeHash } = await validateTree(directory, manifest);

    if (
      record.format !== format ||
      record.key !== key ||
      record.lockHash !== lockHash ||
      record.treeHash !== treeHash ||
      (await readFile(join(directory, "import.mjs"), "utf8")) !== resolver
    )
      throw new Error("installation completion record changed");
  } catch (cause) {
    throw new Error(`incomplete or changed package cache: ${directory}`, { cause });
  }
}

async function install(
  directory: string,
  manifest: string,
  registry: string,
  options: CacheOptions,
) {
  await writeFile(join(directory, "package.json"), manifest);

  try {
    await execute(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--omit=dev",
        "--no-audit",
        "--no-fund",
        "--fetch-retries=0",
        "--package-lock=true",
        `--registry=${registry}`,
        `--cache=${join(resolve(options.cacheDirectory), "npm-cache")}`,
      ],
      { cwd: directory, signal: options.signal, maxBuffer: 1_048_576 },
    );
  } catch (cause) {
    throw new Error("additional package installation failed", { cause });
  }

  options.signal.throwIfAborted();
}

async function publish(staging: string, directory: string, manifest: string, key: string) {
  try {
    await rename(staging, directory);
  } catch (error) {
    if (!["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;

    // A concurrent installer may have completed the same immutable snapshot first.
    await validateSnapshot(directory, manifest, key);
  }
}

export async function installPackages(packages: Record<string, string>, options: CacheOptions) {
  const registry = registryUrl(options.registry);
  const dependencies = Object.fromEntries(
    Object.entries(packages).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  const manifest = `${JSON.stringify({ name: "ctvs-kupo-plugins", version: "0.0.0", private: true, dependencies }, null, 2)}\n`;
  const key = digest(
    JSON.stringify({
      format,
      dependencies,
      registry,
      platform: platform(),
      arch: arch(),
      abi: process.versions.modules,
    }),
  );
  const installs = join(resolve(options.cacheDirectory), "installs");
  const directory = join(installs, key);

  options.signal.throwIfAborted();

  if (await exists(directory)) {
    await validateSnapshot(directory, manifest, key);

    return directory;
  }

  await mkdir(installs, { recursive: true });

  const staging = await mkdtemp(join(installs, ".stage-"));

  try {
    await install(staging, manifest, registry, options);

    const hashes = await validateTree(staging, manifest);

    await writeFile(join(staging, "import.mjs"), resolver);
    await writeFile(join(staging, "complete.json"), JSON.stringify({ format, key, ...hashes }));
    options.signal.throwIfAborted();
    await publish(staging, directory, manifest, key);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }

  return directory;
}
