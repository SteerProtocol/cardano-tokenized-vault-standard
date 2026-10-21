/** Create a fresh, isolated G0 environment. Keys remain in ignored, private artifact directories. */
import assert from "node:assert/strict";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { referenceRoot } from "../../../../../tools/lib/project.js";
import { docker, eventually, nodeImage, write } from "./environment.js";

const fixtures = fileURLToPath(new URL("../fixtures/", import.meta.url));
const override = fileURLToPath(new URL("../compose.override.yml", import.meta.url));

function generate(directory: string, fork: boolean, forkSecurityParam: number) {
  const spec = JSON.parse(readFileSync(join(fixtures, "shelley.spec.json"), "utf8"));
  const start = new Date(Date.now() + 10000).toISOString().replace(/\.\d+Z$/, "Z");

  spec.systemStart = start;

  if (fork) {
    spec.securityParam = forkSecurityParam;
    spec.epochLength = Math.max(spec.epochLength, forkSecurityParam * 10);
  }

  write(directory, "shelley.spec", spec);
  docker([
    "run",
    "--rm",
    "--entrypoint",
    "cardano-cli",
    "-v",
    `${directory}:/work`,
    nodeImage,
    "conway",
    "genesis",
    "create-testnet-data",
    "--spec-shelley",
    "/work/shelley.spec.json",
    "--genesis-keys",
    "1",
    "--pools",
    "1",
    "--stake-delegators",
    "1",
    "--utxo-keys",
    "1",
    "--testnet-magic",
    "42",
    "--total-supply",
    "1000000000000000",
    "--delegated-supply",
    "500000000000000",
    "--start-time",
    start,
    "--out-dir",
    "/work/genesis",
  ]);

  const network = join(directory, "network");

  mkdirSync(join(network, "genesis"), { recursive: true });

  for (const name of ["byron", "shelley", "alonzo", "conway", "dijkstra"])
    copyFileSync(
      join(directory, `genesis/${name}-genesis.json`),
      join(network, `genesis/${name}-genesis.json`),
    );

  for (const name of ["byron", "shelley", "alonzo", "conway", "dijkstra"])
    chmodSync(join(network, `genesis/${name}-genesis.json`), 0o644);

  const alonzoPath = join(network, "genesis/alonzo-genesis.json");
  const alonzo = JSON.parse(readFileSync(alonzoPath, "utf8"));

  alonzo.maxTxExUnits = { exUnitsMem: 14000000, exUnitsSteps: 10000000000 };
  writeFileSync(alonzoPath, `${JSON.stringify(alonzo, null, 2)}\n`);

  for (const name of ["config.json", "topology.json"])
    copyFileSync(join(fixtures, name), join(network, name));

  if (fork) {
    const config = JSON.parse(readFileSync(join(network, "config.json"), "utf8"));

    config.TxSubmissionInitDelay = 1;
    write(network, "config", config);
  }

  chmodSync(join(directory, "genesis/pools-keys/pool1/vrf.skey"), 0o600);

  const deployment = readFileSync(override, "utf8");

  writeFileSync(
    join(directory, "compose.override.yml"),
    fork
      ? deployment.replace(
          "--database-path, /node-db",
          '--host-addr, 0.0.0.0, --port, "3001", --database-path, /node-db',
        )
      : deployment,
  );

  return network;
}

function fund(directory: string, node: string) {
  const cli = (...args: string[]) =>
    docker([
      "run",
      "--rm",
      "--volumes-from",
      `${node}:ro`,
      "-v",
      `${directory}:/work`,
      "--entrypoint",
      "cardano-cli",
      nodeImage,
      ...args,
    ]);

  const address = cli(
    "address",
    "build",
    "--payment-verification-key-file",
    "/work/genesis/utxo-keys/utxo1/utxo.vkey",
    "--testnet-magic",
    "42",
  );
  const utxos = JSON.parse(
    cli(
      "conway",
      "query",
      "utxo",
      "--address",
      address,
      "--testnet-magic",
      "42",
      "--socket-path",
      "/ipc/node.socket",
      "--out-file",
      "/dev/stdout",
    ),
  );
  const input = Object.keys(utxos)[0];

  assert.ok(input);
  cli(
    "conway",
    "transaction",
    "build",
    "--tx-in",
    input,
    "--tx-out",
    `${address}+5000000000`,
    "--tx-out",
    `${address}+5000000000`,
    "--tx-out",
    `${address}+100000000`,
    "--change-address",
    address,
    "--testnet-magic",
    "42",
    "--socket-path",
    "/ipc/node.socket",
    "--out-file",
    "/work/funding.body",
  );
  cli(
    "conway",
    "transaction",
    "sign",
    "--tx-body-file",
    "/work/funding.body",
    "--signing-key-file",
    "/work/genesis/utxo-keys/utxo1/utxo.skey",
    "--testnet-magic",
    "42",
    "--out-file",
    "/work/funding.signed",
  );
  cli(
    "conway",
    "transaction",
    "submit",
    "--tx-file",
    "/work/funding.signed",
    "--testnet-magic",
    "42",
    "--socket-path",
    "/ipc/node.socket",
  );

  return address;
}

export async function prepare(options: { fork?: boolean; forkSecurityParam?: number } = {}) {
  const parent = join(referenceRoot, "artifacts/indexer/node");

  mkdirSync(parent, { recursive: true });

  const directory = mkdtempSync(join(parent, "g0-"));

  chmodSync(directory, 0o700);

  const project = `ctvs-${directory.split("/").at(-1)?.toLowerCase()}`;
  const network = generate(directory, options.fork ?? false, options.forkSecurityParam ?? 100);

  writeFileSync(
    join(directory, "stack.env"),
    Object.entries({
      CTVS_STACK_NAME: project,
      NODE_CONFIG_DIR: network,
      INDEXER_CONFIG: join(directory, "indexer.json"),
      G0_POOL_KEYS: join(directory, "genesis/pools-keys/pool1"),
      OGMIOS_PORT: "19005",
      KUPO_PORT: "19006",
      INDEXER_PORT: "19080",
    })
      .map(([key, value]) => `${key}=${value}\n`)
      .join(""),
  );

  const compose = (...args: string[]) =>
    docker([
      "compose",
      "--env-file",
      join(directory, "stack.env"),
      "-f",
      join(referenceRoot, "services/indexer/compose.yml"),
      "-f",
      join(directory, "compose.override.yml"),
      ...args,
    ]);

  try {
    compose("build", "indexer");
    compose("up", "-d", "node", "ogmios", "kupo");
    await eventually(async () => {
      try {
        const tip = JSON.parse(
          docker([
            "exec",
            `${project}-node-1`,
            "cardano-cli",
            "conway",
            "query",
            "tip",
            "--testnet-magic",
            "42",
            "--socket-path",
            "/ipc/node.socket",
          ]),
        );

        return tip.era === "Conway" && tip.slot > 0 ? true : undefined;
      } catch {
        return undefined;
      }
    }, "Conway block production");

    const address = fund(directory, `${project}-node-1`);

    await eventually(async () => {
      const health = await fetch("http://127.0.0.1:19005/health").catch(() => null);

      if (!health?.ok) return undefined;

      if ((await health.json()).connectionStatus !== "connected") return undefined;

      const result = await fetch(`http://127.0.0.1:19006/matches/${address}?unspent`).catch(
        () => null,
      );

      if (!result?.ok) return undefined;

      const outputs = await result.json();

      return Array.isArray(outputs) && outputs.length >= 3 ? true : undefined;
    }, "indexed ordinary faucet outputs");
    console.log(`G0 disposable environment: ${directory}`);

    return directory;
  } catch (error) {
    try {
      compose("down");
    } catch (shutdown) {
      throw new AggregateError([error, shutdown], "Node setup and shutdown failed");
    }

    throw error;
  }
}
