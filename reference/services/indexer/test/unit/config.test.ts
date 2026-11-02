/** Bootstrap rejects ambiguous identities, fake origins, unsafe transport quantities and malformed scope. */
import { rmSync, writeFileSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import { journalIdentity, loadConfig } from "../../src/config.js";
import { setup } from "./fixtures.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

it("normalizes scope and paths, pins original genesis bytes and ignores movable endpoints in journal identity", () => {
  const f = setup();

  directories.push(f.directory);
  expect(f.config.database).toBe(`${f.directory}/journal.sqlite`);
  expect(f.config.limits.maxLagSlots).toBe(0);
  expect(f.config.kupoCoverage).toBeNull();

  const config = {
    ...f.config,
    sources: { kupo: "http://example.test", ogmios: "http://example.test" },
  };

  expect(journalIdentity(config)).toBe(journalIdentity(f.config));
  expect(
    journalIdentity({ ...config, tracking: { mode: "selected", vaults: [f.policy] } }),
  ).not.toBe(journalIdentity(config));
});

it("rejects invalid bootstrap, network, reviewed programs, scope, limits and endpoints", () => {
  const f = setup();

  directories.push(f.directory);

  const invalid = [
    { intersection: { slot: "0", blockHash: "00".repeat(32) } },
    { intersection: { slot: "9007199254740993", blockHash: "ef".repeat(32) } },
    { network: { ...f.raw.network, genesisHash: "01".repeat(32) } },
    { network: { ...f.raw.network, networkMagic: 43 } },
    { network: { ...f.raw.network, networkId: 1 } },
    { network: { ...f.raw.network, domain: "bad" } },
    { network: { ...f.raw.network, networkMagic: -1 } },
    { reviewedBuilds: [] },
    { reviewedBuilds: [f.reviewed, f.reviewed] },
    { reviewedBuilds: [{ ...f.reviewed, family: "unknown" }] },
    { reviewedBuilds: [{ ...f.reviewed, vaultTemplate: "odd" }] },
    { reviewedBuilds: [{ ...f.reviewed, config: { type: "PlutusV2", script: "00" } }] },
    { reviewedBuilds: [{ ...f.reviewed, family: "ctvs1" }] },
    { tracking: { mode: "selected", vaults: [] } },
    { tracking: { mode: "selected", vaults: [f.policy, f.policy.toUpperCase()] } },
    { tracking: { mode: "selected", vaults: ["bad"] } },
    { tracking: { mode: "all", vaults: [f.policy] } },
    { sources: { ...f.raw.sources, kupo: "http://user:secret@example.test" } },
    { sources: { ...f.raw.sources, ogmios: "ftp://example.test" } },
    { limits: { maxBlocks: 0 } },
    { limits: { maxTransactions: 1.1 } },
    { limits: { typo: 1 } },
    { limits: { lookupMaxAgeMs: 60001 } },
    { kupoCoverage: { since: "tip", match: "*", spent: "retain" } },
    { kupoCoverage: { since: "origin", match: "addr_test", spent: "retain" } },
    { kupoCoverage: { since: "origin", match: "*", spent: "prune" } },
    { kupoCoverage: { since: "origin", match: "*", spent: "retain", typo: true } },
    { http: { host: "127.0.0.1", port: 0 } },
  ];

  for (const change of invalid) {
    writeFileSync(f.filename, JSON.stringify({ ...f.raw, ...change }));
    expect(() => loadConfig(f.filename)).toThrow();
  }
});

it("accepts selected scope and independently compiled CTVS-1 builds", () => {
  const f = setup();

  directories.push(f.directory);
  writeFileSync(
    f.filename,
    JSON.stringify({
      ...f.raw,
      kupoCoverage: { since: "origin", match: "*", spent: "retain" },
      tracking: { mode: "selected", vaults: [f.policy.toUpperCase()] },
      reviewedBuilds: [{ ...f.reviewed, family: "ctvs1", claim: null }],
    }),
  );
  expect(loadConfig(f.filename).tracking).toEqual({ mode: "selected", vaults: [f.policy] });
  expect(loadConfig(f.filename).kupoCoverage).toEqual({
    since: "origin",
    match: "*",
    spent: "retain",
  });
});
