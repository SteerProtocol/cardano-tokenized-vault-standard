import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { prepareManagedStorage } from "../src/managed-storage.js";

const network = { networkId: 0, networkMagic: 42, genesisHash: "11".repeat(32) };
const directories: string[] = [];
const markerName = ".ctvs-kupo.json";

afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function directory() {
  const parent = await mkdtemp(join(tmpdir(), "ctvs-kupo-storage-"));

  directories.push(parent);

  return join(parent, "data");
}

it("initializes only fresh storage and records the fixed network/origin/retain policy", async () => {
  const data = await directory();

  expect(await prepareManagedStorage(data, network)).toBe("initialized");
  expect(await readdir(data)).toEqual([markerName]);
  expect(JSON.parse(await readFile(join(data, markerName), "utf8"))).toEqual({
    format: "CTVS-KUPO-MANAGED-1",
    network,
    since: "origin",
    spent: "retain",
  });
});

it("reuses the initialization intent after interruption before Kupo creates its database", async () => {
  const data = await directory();

  await prepareManagedStorage(data, network);

  const original = await readFile(join(data, markerName));

  expect(await prepareManagedStorage(data, structuredClone(network))).toBe("reused");
  expect(await readdir(data)).toEqual([markerName]);
  expect(await readFile(join(data, markerName))).toEqual(original);
});

it("leaves managed database files untouched during reuse", async () => {
  const data = await directory();

  await prepareManagedStorage(data, network);
  await writeFile(join(data, "kupo.sqlite3"), "database-owned-by-kupo");
  await writeFile(join(data, "kupo.sqlite3-wal"), "journal-owned-by-kupo");

  expect(await prepareManagedStorage(data, network)).toBe("reused");
  expect(await readFile(join(data, "kupo.sqlite3"), "utf8")).toBe("database-owned-by-kupo");
  expect(await readFile(join(data, "kupo.sqlite3-wal"), "utf8")).toBe("journal-owned-by-kupo");
});

it.each([
  "kupo.sqlite3",
  "kupo.sqlite3-wal",
  "kupo.sqlite3-shm",
  "kupo.sqlite3-journal",
  "unrelated.txt",
])(
  "refuses unrecognized/imported data without creating a marker or modifying it (%s)",
  async (name) => {
    const data = await directory();

    await mkdir(data);
    await writeFile(join(data, name), "existing-data");
    await expect(prepareManagedStorage(data, network)).rejects.toThrow("fresh empty directory");
    expect(await readdir(data)).toEqual([name]);
    expect(await readFile(join(data, name), "utf8")).toBe("existing-data");
  },
);

it.each([
  { ...network, networkId: 1 },
  { ...network, networkMagic: 43 },
  { ...network, genesisHash: "22".repeat(32) },
])("refuses a changed initialization network (%j)", async (other) => {
  const data = await directory();

  await prepareManagedStorage(data, network);

  const original = await readFile(join(data, markerName));

  await expect(prepareManagedStorage(data, other)).rejects.toThrow("different network/policy");
  expect(await readFile(join(data, markerName))).toEqual(original);
});

it.each(["", "{", "null", "{}", "old-format", "pruned", "later-start"])(
  "refuses partial, corrupt or incompatible initialization markers (%s)",
  async (value) => {
    const data = await directory();

    await prepareManagedStorage(data, network);

    const original = await readFile(join(data, markerName), "utf8");
    const contents =
      value === "pruned"
        ? original.replace('"retain"', '"prune"')
        : value === "later-start"
          ? original.replace('"origin"', '"tip"')
          : value;

    await writeFile(join(data, markerName), contents);
    await writeFile(join(data, "kupo.sqlite3"), "preserve-this");
    await expect(prepareManagedStorage(data, network)).rejects.toThrow("marker is invalid");
    expect(await readFile(join(data, markerName), "utf8")).toBe(contents);
    expect(await readFile(join(data, "kupo.sqlite3"), "utf8")).toBe("preserve-this");
  },
);

it("rejects an invalid network before creating storage", async () => {
  const data = await directory();

  await expect(
    prepareManagedStorage(data, { ...network, genesisHash: "invalid" }),
  ).rejects.toThrow();
  await expect(readdir(data)).rejects.toMatchObject({ code: "ENOENT" });
});

it("propagates filesystem failures without replacing the marker", async () => {
  const data = await directory();

  await mkdir(join(data, markerName), { recursive: true });
  await expect(prepareManagedStorage(data, network)).rejects.toMatchObject({ code: "EISDIR" });
  expect(await readdir(data)).toEqual([markerName]);
});
