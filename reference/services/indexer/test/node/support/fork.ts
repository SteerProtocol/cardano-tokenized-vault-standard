/** Real node-to-node fork selection. Database files are never rewound or edited. */
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { ChainPoint } from "@ctvs/planning";
import { Cleanup } from "../../support/cleanup.js";
import { docker, eventually, nodeImage, write } from "./environment.js";
import type { Env } from "./flow.js";

export interface ForkNode {
  name: string;
  directory: string;
  socket: string;
  keys: string;
}
export interface NodeTip {
  slot: number;
  hash: string;
  block: number;
}

export const point = (tip: NodeTip): ChainPoint => ({
  slot: BigInt(tip.slot),
  blockHash: tip.hash,
});

export function tip(node: ForkNode): NodeTip {
  return JSON.parse(
    docker([
      "exec",
      node.name,
      "cardano-cli",
      "conway",
      "query",
      "tip",
      "--testnet-magic",
      "42",
      "--socket-path",
      node.socket,
    ]),
  );
}

function topology(directory: string, peer: string): void {
  write(directory, "topology", {
    localRoots: [
      {
        accessPoints: [{ address: peer, port: 3001 }],
        advertise: false,
        valency: 1,
        trustable: true,
      },
    ],
    publicRoots: [],
    useLedgerAfterSlot: -1,
  });
}

function reload(node: ForkNode): void {
  docker(["kill", "--signal", "HUP", node.name]);
}

export async function freeze(node: ForkNode): Promise<NodeTip> {
  const enabled = join(node.keys, "kes.skey");

  if (existsSync(enabled)) renameSync(enabled, `${enabled}.disabled`);

  reload(node);

  return eventually(async () => {
    const before = tip(node);

    await delay(1000);

    const after = tip(node);

    return before.hash === after.hash ? after : undefined;
  }, `${node.name} stopped forging`);
}

export function forge(node: ForkNode): void {
  const enabled = join(node.keys, "kes.skey");

  if (!existsSync(enabled)) renameSync(`${enabled}.disabled`, enabled);

  reload(node);
}

export function primary(env: Env): ForkNode {
  return {
    name: `${env.project}-node-1`,
    directory: join(env.directory, "network"),
    keys: join(env.directory, "genesis/pools-keys/pool1"),
    socket: "/ipc/node.socket",
  };
}

/** Sync a non-producing isolated copy to a frozen primary, then preserve its ordinary node database. */
export async function checkpoint(
  env: Env,
  label: string,
  copies: ForkNode[],
): Promise<{ node: ForkNode; common: ChainPoint }> {
  const original = primary(env);
  const selected = await freeze(original);
  const directory = join(env.directory, "forks", label);

  mkdirSync(directory, { recursive: true, mode: 0o700 });

  const keys = join(directory, "keys");

  cpSync(original.keys, keys, { recursive: true });
  renameSync(join(keys, "kes.skey.disabled"), join(keys, "kes.skey"));

  const node = { name: `${env.project}-${label}`, directory, keys, socket: "/tmp/fork.socket" };

  copies.push(node);
  topology(directory, original.name);
  docker([
    "run",
    "-d",
    "--name",
    node.name,
    "--network",
    `${env.project}_default`,
    "--label",
    `ctvs.disposable.project=${env.project}`,
    "--entrypoint",
    "cardano-node",
    "-v",
    `${join(env.directory, "network")}:/network:ro`,
    "-v",
    `${directory}:/fork`,
    "-w",
    "/network",
    nodeImage,
    "run",
    "--config",
    "/network/config.json",
    "--topology",
    "/fork/topology.json",
    "--database-path",
    "/fork/db",
    "--socket-path",
    node.socket,
    "--host-addr",
    "0.0.0.0",
    "--port",
    "3001",
    "--shelley-kes-key",
    "/fork/keys/kes.skey",
    "--shelley-vrf-key",
    "/fork/keys/vrf.skey",
    "--shelley-operational-certificate",
    "/fork/keys/opcert.cert",
    "--start-as-non-producing-node",
  ]);
  await eventually(async () => {
    try {
      return tip(node).hash === selected.hash ? true : undefined;
    } catch {
      return undefined;
    }
  }, `${label} common ancestor synchronization`);
  docker(["stop", node.name]);
  topology(directory, "127.0.0.1");

  const common = point(selected);

  write(env.directory, `${label}-checkpoint`, {
    common,
    block: selected.block,
    node: node.name,
    source: original.name,
  });

  return { node, common };
}

/** Let an isolated producer outgrow the frozen canonical branch; connect the live node without resetting it. */
export async function adopt(env: Env, fork: ForkNode, label: string) {
  const original = primary(env);
  const before = await freeze(original);

  docker(["start", fork.name]);
  await eventually(async () => {
    try {
      return tip(fork).hash ? true : undefined;
    } catch {
      return undefined;
    }
  }, "fork socket");
  forge(fork);
  await eventually(
    async () => (tip(fork).block > before.block + 2 ? true : undefined),
    "strictly longer alternate chain",
  );

  const replacement = await freeze(fork);

  topology(original.directory, fork.name);
  reload(original);
  await eventually(
    async () => (tip(original).hash === replacement.hash ? true : undefined),
    "live node selected replacement branch",
  );
  // After branch selection, the producer also needs the relay as an outbound peer
  // to request newly submitted transactions. Both nodes remain frozen here.
  topology(fork.directory, original.name);
  reload(fork);
  write(env.directory, `${label}-selection`, {
    before,
    replacement,
    selected: tip(original),
    fork: fork.name,
  });
  assert.notEqual(replacement.hash, before.hash);

  return replacement;
}

export async function stopCopies(env: Pick<Env, "directory">, copies: ForkNode[]): Promise<void> {
  const cleanup = new Cleanup();

  for (const node of copies) {
    cleanup.defer(() => docker(["stop", node.name]));
    cleanup.defer(() =>
      writeFileSync(
        join(env.directory, `${node.name}-node.log`),
        docker(["logs", "--tail", "600", node.name]),
      ),
    );
  }

  await cleanup.close();
}
