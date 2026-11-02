/** Recognize wrapper-owned initialization; Kupo owns database contents and restart decisions. */
import { mkdir, open, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { type NetworkIdentity, networkIdentity } from "@ctvs/plugins/indexer";

const markerName = ".ctvs-kupo.json";

async function recognized(marker: string, expected: string) {
  let contents: string;

  try {
    contents = await readFile(marker, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;

    throw error;
  }

  if (contents !== expected)
    throw new Error(
      "Kupo initialization marker is invalid or belongs to a different network/policy",
    );

  return true;
}

export async function prepareManagedStorage(
  directory: string,
  network: NetworkIdentity,
): Promise<"initialized" | "reused"> {
  const expected = `${JSON.stringify({
    format: "CTVS-KUPO-MANAGED-1",
    network: networkIdentity(network),
    since: "origin",
    spent: "retain",
  })}\n`;
  const marker = join(directory, markerName);

  await mkdir(directory, { recursive: true });

  if (await recognized(marker, expected)) return "reused";

  if ((await readdir(directory)).length !== 0)
    throw new Error("unrecognized Kupo storage; initialization requires a fresh empty directory");

  // Exclusive creation never labels an existing database as managed. A torn marker fails closed.
  const file = await open(marker, "wx", 0o600);

  try {
    await file.writeFile(expected);
    await file.sync();
  } finally {
    await file.close();
  }

  return "initialized";
}
