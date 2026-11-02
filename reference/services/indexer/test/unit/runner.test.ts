/** Real SQLite persistence with synthetic chain fixtures, including commit faults and fresh-process WAL recovery. */
import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { journalIdentity } from "../../src/config.js";
import { Runner } from "../../src/runner.js";
import { encode, Journal } from "../../src/storage/journal.js";
import { setup } from "./fixtures.js";

const cleanup: (() => void)[] = [];

afterEach(() => {
  for (const action of cleanup.splice(0).reverse()) action();
});

function fixture() {
  const f = setup();

  cleanup.push(() => rmSync(f.directory, { recursive: true }));

  return f;
}

function run(f: ReturnType<typeof setup>, journal?: Journal) {
  const runner = new Runner(f.config, journal);

  cleanup.push(() => runner.close());
  runner.restore();

  return runner;
}

it("replays durable history but withholds reads until live intersection reconciliation", () => {
  const f = fixture();
  const runner = run(f);

  expect(() => runner.read((reader) => reader.counts)).toThrow("not ready");
  runner.intersect(f.config.intersection, f.block.point);
  expect(runner.status().readerReady).toBe(false);
  runner.forward(f.block, f.block.point);
  expect(runner.read((reader) => reader.snapshot(f.policy)).data.backingAssets).toEqual({
    status: "known",
    value: 0n,
  });
  expect(runner.status().durableHead).toEqual(f.block.point);
  expect(runner.status().lookupReady).toBe(false);
  expect(() => runner.read(async () => 1)).toThrow("synchronous");

  const restarted = run(f);

  expect(restarted.status().readerHead).toEqual(f.block.point);
  expect(restarted.status().readerReady).toBe(false);
  restarted.intersect(f.block.point, f.block.point);
  expect(restarted.read((reader) => reader.counts.vaults)).toBe(1);
});

it("durably removes orphaned genesis and accepts a replacement branch", () => {
  const f = fixture();
  const runner = run(f);

  runner.intersect(f.config.intersection, f.block.point);
  runner.forward(f.block, f.block.point);

  const generation = runner.status().recoveryGeneration;
  const replacement = {
    parent: f.config.intersection,
    point: { slot: 1n, blockHash: "bb".repeat(32) },
    transactions: [],
  };

  runner.backward(f.config.intersection, replacement.point);
  expect(runner.status().recoveryGeneration).toBeGreaterThan(generation);
  expect(runner.status().counts.vaults).toBe(0);
  runner.forward(replacement, replacement.point);

  const restarted = run(f);

  restarted.intersect(replacement.point, replacement.point);
  expect(() => restarted.read((reader) => reader.snapshot(f.policy))).toThrow("genesis");
  expect(restarted.status().history.blocks).toBe(1);
});

it("retains independently observed lag across older forward responses and resets it only after reconciliation", () => {
  const f = fixture();
  const runner = run(f);
  const future = { slot: 5n, blockHash: "cc".repeat(32) };

  runner.intersect(f.config.intersection, f.config.intersection);
  expect(runner.observeTip(future)).toBe(true);
  runner.forward(f.block, f.block.point);
  expect(runner.status().readerReady).toBe(false);
  expect(runner.status().observedTip).toEqual(future);
  expect(runner.observeTip(f.block.point)).toBe(false);
  expect(runner.status().phase).toBe("disconnected");
  expect(() => runner.backward(f.config.intersection, f.block.point)).toThrow("session");
  runner.intersect(f.block.point, f.block.point);
  expect(runner.status().readerReady).toBe(true);
});

it("does not commit invalid CBOR, a conflicting source tip or a block beyond workload limits", () => {
  const f = fixture();
  const runner = run(f);

  runner.intersect(f.config.intersection, f.block.point);
  expect(() => runner.forward({ ...f.block, transactions: ["not-cbor"] }, f.block.point)).toThrow();
  expect(runner.status().durableHead).toEqual(f.config.intersection);

  const another = run(f);

  another.intersect(f.config.intersection, f.block.point);

  expect(() => another.forward(f.block, { ...f.block.point, blockHash: "cc".repeat(32) })).toThrow(
    "tip conflicts",
  );
  expect(another.status().history.blocks).toBe(0);
  f.config.limits.maxBlockBytes = 1;

  const limited = run(f);

  limited.intersect(f.config.intersection, f.block.point);

  expect(() => limited.forward(f.block, f.block.point)).toThrow("byte budget");
  expect(limited.status().history.blocks).toBe(0);
});

it("rolls back both inserted history and head when the actual SQL commit path fails", () => {
  const f = fixture();
  const runner = run(f);
  const db = new DatabaseSync(f.config.database);

  runner.intersect(f.config.intersection, f.block.point);

  db.exec(
    "CREATE TRIGGER reject_head BEFORE UPDATE ON metadata BEGIN SELECT RAISE(ABORT,'simulated disk fault'); END",
  );
  db.close();
  expect(() => runner.forward(f.block, f.block.point)).toThrow("simulated disk fault");
  expect(runner.status().phase).toBe("failed");
  expect(runner.status().durableHead).toEqual(f.config.intersection);
  expect(runner.status().history.blocks).toBe(0);
});

it("refuses projection growth before committing and preserves a restartable last accepted head", () => {
  const f = fixture();

  f.config.limits.maxBlocks = 1;

  const runner = run(f);

  runner.intersect(f.config.intersection, f.block.point);
  runner.forward(f.block, f.block.point);

  const next = {
    parent: f.block.point,
    point: { slot: 2n, blockHash: "bb".repeat(32) },
    transactions: [],
  };

  expect(() => runner.forward(next, next.point)).toThrow("workload budget");
  expect(runner.status().durableHead).toEqual(f.block.point);
  expect(runner.status().history.blocks).toBe(1);

  const restarted = run(f);

  expect(restarted.status().readerHead).toEqual(f.block.point);
});

it("recovers a committed head after interruption before reader publication", () => {
  const f = fixture();

  class Interrupted extends Journal {
    override append(block: Parameters<Journal["append"]>[0]): void {
      super.append(block);

      throw new Error("interrupted after commit");
    }
  }

  const runner = run(
    f,
    new Interrupted(f.config.database, journalIdentity(f.config), f.config.intersection),
  );

  runner.intersect(f.config.intersection, f.block.point);

  expect(() => runner.forward(f.block, f.block.point)).toThrow("after commit");
  expect(runner.status().readerHead).toEqual(f.config.intersection);
  expect(runner.status().durableHead).toEqual(f.block.point);

  const restarted = run(f);

  expect(restarted.status().readerHead).toEqual(f.block.point);
});

it("rejects silent scope changes, preserves selected ownership history and blocks reads after disconnect", () => {
  const f = fixture();

  f.config.tracking = { mode: "selected", vaults: ["aa".repeat(28)] };

  const runner = run(f);

  runner.intersect(f.config.intersection, f.block.point);
  runner.forward(f.block, f.block.point);
  expect(runner.read((reader) => reader.counts.vaults)).toBe(0);
  expect(runner.status().counts.utxos).toBeGreaterThan(0);
  runner.disconnect();
  expect(() => runner.read((reader) => reader.counts)).toThrow("ready");
  expect(() => new Runner({ ...f.config, tracking: { mode: "all" } })).toThrow("scope mismatch");
});

it("rejects rollback outside retained history and mismatched stored heads", () => {
  const f = fixture();
  const runner = run(f);

  runner.intersect(f.config.intersection, f.block.point);

  expect(() => runner.backward({ slot: 0n, blockHash: "aa".repeat(32) }, f.block.point)).toThrow(
    "intersection",
  );

  const db = new DatabaseSync(f.config.database);

  db.prepare("UPDATE metadata SET value=? WHERE key='head'").run(encode(f.block.point));
  db.close();

  const restarted = new Runner(f.config);

  cleanup.push(() => restarted.close());
  expect(() => restarted.restore()).toThrow("disagrees");
});

it.each(["before_commit", "after_commit"])("recovers WAL after a process exits %s", (mode) => {
  const f = fixture();
  const event = join(f.directory, "event.json");

  writeFileSync(event, encode(f.block));

  const worker = fileURLToPath(new URL("./crash-worker.ts", import.meta.url));
  const result = spawnSync(process.execPath, ["--import", "tsx", worker, f.filename, event, mode], {
    encoding: "utf8",
  });

  expect(result.status, result.stderr).toBe(23);

  const restarted = run(f);

  expect(restarted.status().readerHead).toEqual(
    mode === "after_commit" ? f.block.point : f.config.intersection,
  );
});
