/** G0 operates only on an explicitly selected, locally generated magic-42 stack. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { ReviewedBuild } from "@ctvs/integration";
import {
  findValidator,
  readBlueprint,
  referenceRoot,
  sha256,
} from "../../../../../tools/lib/project.js";
import { loadConfig } from "../../../src/config.js";
import { withCleanup } from "../../support/cleanup.js";

export const nodeImage =
  "ghcr.io/intersectmbo/cardano-node@sha256:007da778998d0bdb043fb834c62b9da1c95e33610f31f6f9cccab29a945e2b99";
export const queryUrl = "http://127.0.0.1:19080";

export function write(directory: string, name: string, value: unknown): void {
  writeFileSync(
    join(directory, `${name}.json`),
    `${JSON.stringify(value, (_key, v: unknown) => (typeof v === "bigint" ? v.toString() : v), 2)}\n`,
  );
}

export function docker(args: string[]): string {
  return execFileSync("docker", args, {
    encoding: "utf8",
    timeout: 60000,
    maxBuffer: 8000000,
  }).trim();
}

function reviewedBuild(family: ReviewedBuild["family"]): ReviewedBuild {
  const blueprintPath = join(referenceRoot, `artifacts/${family}/blueprint.json`);
  const blueprint = readBlueprint(blueprintPath);

  return {
    family,
    buildId: sha256(readFileSync(blueprintPath)),
    vaultTemplate: findValidator(blueprint, "vault.vault.spend").compiledCode,
    config: {
      type: "PlutusV3",
      script: findValidator(blueprint, "config_lock.config_lock.spend").compiledCode,
    },
    claim:
      family === "ctvs2"
        ? {
            type: "PlutusV3",
            script: findValidator(blueprint, "claim.claim_guard.spend").compiledCode,
          }
        : null,
  };
}

/** Resolve only an owned generated stack, without requiring healthy services or a readable journal. */
export function nodeStack(requested: string | undefined) {
  assert.ok(requested, "Set CTVS_INDEXER_NODE_DIR to the generated G0 artifact directory");

  const directory = realpathSync(requested);

  assert.ok(
    directory.startsWith(join(referenceRoot, "artifacts/indexer/node/g0-")),
    "Only generated G0 artifacts are allowed",
  );
  assert.match(basename(directory), /^g0-[a-zA-Z0-9_-]+$/);

  const project = `ctvs-${basename(directory).toLowerCase()}`;

  const cli = (...args: string[]) => docker(["exec", `${project}-node-1`, "cardano-cli", ...args]);

  const compose = (...args: string[]) =>
    docker([
      "compose",
      "--env-file",
      join(directory, "stack.env"),
      "-f",
      join(referenceRoot, "services/indexer/compose.yml"),
      "-f",
      existsSync(join(directory, "compose.override.yml"))
        ? join(directory, "compose.override.yml")
        : join(directory, "compose.override.json"),
      ...args,
    ]);

  return { directory, project, cli, compose };
}

export function environment(
  requested = process.env.CTVS_INDEXER_NODE_DIR,
  family: ReviewedBuild["family"] = "ctvs1",
) {
  const { directory, project, cli, compose } = nodeStack(requested);

  const publicGenesis = join(directory, "network/genesis/shelley-genesis.json");
  const genesisPath = existsSync(publicGenesis)
    ? publicGenesis
    : join(directory, "genesis/shelley-genesis.json");
  const bytes = readFileSync(genesisPath);
  const genesis = JSON.parse(bytes.toString()) as {
    networkMagic: number;
    systemStart: string;
    slotLength: number;
  };

  assert.equal(genesis.networkMagic, 42);

  const tip = JSON.parse(
    cli("conway", "query", "tip", "--testnet-magic", "42", "--socket-path", "/ipc/node.socket"),
  );

  assert.equal(tip.era, "Conway");

  const reviewed = reviewedBuild(family);
  const genesisHash = createHash("sha256").update(bytes).digest("hex");
  const prior = join(directory, "host-indexer.json");

  if (existsSync(prior))
    assert.equal(
      JSON.parse(readFileSync(prior, "utf8")).reviewedBuilds[0].family,
      family,
      "Diagnostic retry must retain its original family",
    );

  const intersection = existsSync(prior)
    ? JSON.parse(readFileSync(prior, "utf8")).intersection
    : { slot: String(tip.slot), blockHash: tip.hash };
  const raw = {
    network: {
      name: "ctvs-disposable-g0",
      networkId: 0,
      networkMagic: 42,
      genesisHash,
      domain: createHash("sha256").update(`CTVS/G0/${genesisHash}`).digest("hex"),
    },
    genesisPath,
    intersection,
    reviewedBuilds: [reviewed],
    tracking: { mode: "all" },
    database: join(directory, "host-unused.sqlite"),
    sources: { kupo: "http://127.0.0.1:19006", ogmios: "http://127.0.0.1:19005" },
    kupoCoverage: { since: "origin", match: "*", spent: "retain" },
    http: { host: "127.0.0.1", port: 19080 },
  };

  write(directory, "host-indexer", raw);
  write(directory, "indexer", {
    ...raw,
    genesisPath: existsSync(publicGenesis)
      ? "/network/genesis/shelley-genesis.json"
      : "/configuration/shelley-genesis.json",
    database: "/data/indexer.sqlite",
    sources: { kupo: "http://kupo:1442", ogmios: "http://ogmios:1337" },
    http: { host: "0.0.0.0", port: 8080 },
  });
  write(directory, "observed-node-tip", tip);
  write(directory, "bootstrap-point", intersection);

  const config = loadConfig(join(directory, "host-indexer.json"));

  return { directory, project, cli, genesis, config, reviewed, compose };
}

export async function eventually<T>(read: () => Promise<T | undefined>, label: string): Promise<T> {
  const deadline = Date.now() + 60000;

  while (Date.now() < deadline) {
    const value = await read();

    if (value !== undefined) return value;

    await delay(200);
  }

  throw new Error(`Timed out waiting for ${label}`);
}

export function journalSnapshot(env: Pick<ReturnType<typeof environment>, "project">) {
  const journal = docker([
    "exec",
    `${env.project}-indexer-1`,
    "node",
    "--input-type=module",
    "-e",
    "import { DatabaseSync } from 'node:sqlite'; const db=new DatabaseSync('/data/indexer.sqlite',{readOnly:true}); console.log(JSON.stringify({runtime:process.version,metadata:db.prepare('SELECT * FROM metadata').all(),blocks:db.prepare('SELECT body FROM blocks ORDER BY sequence').all().map(row=>JSON.parse(row.body))})); db.close();",
  ]);

  return JSON.parse(journal) as {
    runtime: string;
    metadata: { key: string; value: string }[];
    blocks: {
      point: { slot: string; blockHash: string };
      parent: { slot: string; blockHash: string };
      transactions: string[];
    }[];
  };
}

/** Read a bounded journal snapshot before stopping the owned stack; never export generated signing keys. */
export async function finish(
  env: Pick<ReturnType<typeof environment>, "directory" | "project" | "compose">,
): Promise<void> {
  return withCleanup(async (cleanup) => {
    // Stopped test networks still reserve a subnet. Retain containers and volumes,
    // but release this owned network after every producer and service has stopped.
    cleanup.defer(() => docker(["network", "rm", `${env.project}_default`]));
    cleanup.defer(() => env.compose("stop"));

    try {
      write(env.directory, "journal-snapshot", journalSnapshot(env));
      write(
        env.directory,
        "images",
        Object.fromEntries(
          ["node", "ogmios", "kupo", "indexer"].map((service) => [
            service,
            docker(["inspect", "--format", "{{.Image}}", `${env.project}-${service}-1`]),
          ]),
        ),
      );
    } catch (error) {
      write(env.directory, "snapshot-error", {
        message: error instanceof Error ? error.message : String(error),
      });
    }

    writeFileSync(
      join(env.directory, "stack.log"),
      env.compose("logs", "--no-color", "--tail", "300"),
    );
  });
}
