/** Exercise the pinned Kupo executable and SQLite worker without a node, reader or network access. */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import type { Cleanup } from "../../../test/support/cleanup.js";

export const image =
  "cardanosolutions/kupo@sha256:7d3c62368a4a5a609f5cf0ee6949eb8d491ed8f5a4d05b38da3213d95735f03b";

const execute = promisify(execFile);

export async function docker(args: string[]) {
  const { stdout } = await execute("docker", args, { timeout: 30_000, maxBuffer: 1_048_576 });

  return stdout.trim();
}

export async function until<T>(read: () => Promise<T | undefined>, label: string) {
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    const value = await read();

    if (value !== undefined) return value;

    await delay(100);
  }

  throw new Error(`timed out waiting for ${label}`);
}

export async function startKupo(directory: string, args: readonly string[], cleanup: Cleanup) {
  const name = `ctvs-kupo-policy-${randomUUID()}`;
  const user = `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`;

  await docker([
    "create",
    "--pull=never",
    "--name",
    name,
    "--network",
    "none",
    "--user",
    user,
    "--mount",
    `type=bind,source=${directory},target=/data`,
    image,
    "--ogmios-host",
    "127.0.0.1",
    "--ogmios-port",
    "1",
    "--workdir",
    "/data",
    "--gc-interval",
    "1",
    ...args,
  ]);
  cleanup.defer(() => docker(["rm", "-f", name]));
  await docker(["start", name]);

  async function logs() {
    const { stdout, stderr } = await execute("docker", ["logs", name], {
      timeout: 30_000,
      maxBuffer: 1_048_576,
    });

    return stdout + stderr;
  }

  async function exited() {
    const state = JSON.parse(await docker(["inspect", "--format", "{{json .State}}", name]));

    return state.Running ? undefined : (state.ExitCode as number);
  }

  async function initialized() {
    await until(async () => {
      const output = await logs();
      const code = await exited();

      if (code !== undefined) throw new Error(`Kupo exited (${code}): ${output}`);

      return output.includes('"ConfigurationCheckpointsForIntersection"') &&
        output.includes('"HttpServerListening"')
        ? true
        : undefined;
    }, "Kupo initialization");
  }

  async function collected() {
    await until(async () => {
      const output = await logs();
      const code = await exited();

      if (code !== undefined) throw new Error(`Kupo exited (${code}): ${output}`);

      return output.includes('"beginQuery":"PRAGMA optimize"') ? true : undefined;
    }, "Kupo garbage collection");
  }

  return {
    logs,
    exited,
    initialized,
    collected,
    stop: () => docker(["stop", "--time", "5", name]),
  };
}

export function snapshot(directory: string) {
  const db = new DatabaseSync(join(directory, "kupo.sqlite3"), { readOnly: true });

  try {
    return {
      version: db.prepare("PRAGMA user_version").get()?.user_version,
      patterns: db.prepare("SELECT pattern FROM patterns ORDER BY pattern").all(),
      checkpoints: db
        .prepare("SELECT slot_no, hex(header_hash) AS hash FROM checkpoints ORDER BY slot_no DESC")
        .all(),
      inputs: db
        .prepare(
          "SELECT hex(ext_output_reference) AS ref, created_at, spent_at FROM inputs ORDER BY ref",
        )
        .all(),
    };
  } finally {
    db.close();
  }
}

export function seed(directory: string) {
  const db = new DatabaseSync(join(directory, "kupo.sqlite3"));

  try {
    const checkpoint = db.prepare("INSERT INTO checkpoints (slot_no, header_hash) VALUES (?, ?)");

    for (const slot of [1, 2, 1_000_000]) checkpoint.run(slot, Buffer.alloc(32, slot % 255));

    const input = db.prepare(
      "INSERT INTO inputs (ext_output_reference, address, value, created_at, spent_at) VALUES (?, ?, ?, ?, ?)",
    );

    // Synthetic SQL rows isolate retention from ledger decoding; Kupo itself creates the schema.
    input.run(Buffer.alloc(36, 1), `60${"11".repeat(28)}`, Buffer.from([0]), 1, 2);
    input.run(Buffer.alloc(36, 2), `60${"11".repeat(28)}`, Buffer.from([0]), 1, null);
  } finally {
    db.close();
  }
}
