/** Test-only abrupt termination at real SQLite transaction boundaries; never used by service runtime. */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { journalIdentity, loadConfig } from "../../src/config.js";
import { encode, Journal } from "../../src/storage/journal.js";

const [filename, eventPath, mode] = process.argv.slice(2);

if (!filename || !eventPath) throw new Error("missing crash test paths");

const config = loadConfig(filename);
const raw = JSON.parse(readFileSync(eventPath, "utf8"));
const block = {
  ...raw,
  parent: { ...raw.parent, slot: BigInt(raw.parent.slot) },
  point: { ...raw.point, slot: BigInt(raw.point.slot) },
};
const journal = new Journal(config.database, journalIdentity(config), config.intersection);

if (mode === "after_commit") journal.append(block);
else {
  journal.close();

  const db = new DatabaseSync(config.database);

  db.exec("BEGIN IMMEDIATE");
  db.prepare("INSERT INTO blocks(hash,body,transactions,bytes) VALUES(?,?,?,?)").run(
    block.point.blockHash,
    encode(block),
    block.transactions.length,
    Buffer.byteLength(encode(block)),
  );
  db.prepare("UPDATE metadata SET value=? WHERE key='head'").run(encode(block.point));
}

process.exit(23);
