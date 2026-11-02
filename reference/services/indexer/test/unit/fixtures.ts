/** Synthetic accepted histories for durability tests; their block headers and transactions do not prove node acceptance. */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readerFixture } from "../../../../packages/integration/test/fixtures.js";
import { loadConfig } from "../../src/config.js";

export function setup(family: "ctvs1" | "ctvs2" = "ctvs2") {
  const fixture = readerFixture(family);
  const directory = mkdtempSync(join(tmpdir(), "ctvs-indexer-"));
  const filename = join(directory, "config.json");
  const genesisPath = join(directory, "shelley-genesis.json");
  const systemStart = "2026-10-01T00:00:00Z";

  writeFileSync(
    genesisPath,
    JSON.stringify({ networkId: "Testnet", networkMagic: 42, systemStart }),
  );

  const raw = {
    network: {
      ...fixture.network,
      genesisHash: createHash("sha256").update(readFileSync(genesisPath)).digest("hex"),
    },
    genesisPath: "shelley-genesis.json",
    intersection: { slot: "0", blockHash: "ef".repeat(32) },
    reviewedBuilds: [fixture.reviewed],
    tracking: { mode: "all" },
    database: "journal.sqlite",
    sources: { kupo: "http://127.0.0.1:1", ogmios: "http://127.0.0.1:1" },
    http: { host: "127.0.0.1", port: 18080 },
  };

  writeFileSync(filename, JSON.stringify(raw));

  const config = loadConfig(filename);
  const block = { ...fixture.genesis.block, parent: config.intersection };

  return { ...fixture, directory, filename, config, block, raw };
}
