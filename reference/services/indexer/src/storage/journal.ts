/** Single-writer SQLite history with atomic head updates; the protocol projection stays in VaultReader. */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AcceptedBlock } from "@ctvs/integration";
import type { ChainPoint } from "@ctvs/planning";
import { object, point, text } from "../config.js";

export const samePoint = (a: ChainPoint, b: ChainPoint): boolean =>
  a.slot === b.slot && a.blockHash === b.blockHash;

export function encode(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "bigint" ? item.toString() : item,
  );
}

function decodeBlock(serialized: string): AcceptedBlock {
  const raw = object(JSON.parse(serialized), "journal block");

  if (!Array.isArray(raw.transactions) || raw.transactions.some((tx) => typeof tx !== "string"))
    throw new Error("invalid journal transactions");

  return { point: point(raw.point), parent: point(raw.parent), transactions: raw.transactions };
}

export interface HistoryStats {
  blocks: number;
  transactions: number;
  historyBytes: number;
}

export class Journal {
  readonly #db: DatabaseSync;
  readonly #intersection: ChainPoint;

  constructor(filename: string, identity: string, intersection: ChainPoint) {
    mkdirSync(dirname(filename), { recursive: true });
    this.#db = new DatabaseSync(filename);
    this.#intersection = structuredClone(intersection);

    try {
      this.#db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
      this.#db.exec(`
        CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS blocks (
          sequence INTEGER PRIMARY KEY, hash TEXT UNIQUE NOT NULL, body TEXT NOT NULL,
          transactions INTEGER NOT NULL, bytes INTEGER NOT NULL
        );
      `);
      this.#bind(identity);

      if (this.#db.prepare("PRAGMA quick_check").get()?.quick_check !== "ok")
        throw new Error("journal integrity check failed");
    } catch (error) {
      this.#db.close();

      throw error;
    }
  }

  #bind(identity: string): void {
    const stored = this.#db.prepare("SELECT value FROM metadata WHERE key='identity'").get();

    if (stored) {
      if (stored.value !== identity)
        throw new Error("journal identity or tracking scope mismatch; explicit rebuild required");

      return;
    }

    if (this.#db.prepare("SELECT count(*) AS count FROM blocks").get()?.count !== 0)
      throw new Error("journal history has no identity");

    this.#transaction(() => {
      this.#db.prepare("INSERT INTO metadata VALUES ('identity', ?)").run(identity);
      this.#db.prepare("INSERT INTO metadata VALUES ('schema', '1')").run();
      this.#db.prepare("INSERT INTO metadata VALUES ('head', ?)").run(encode(this.#intersection));
    });
  }

  get head(): ChainPoint {
    const row = this.#db.prepare("SELECT value FROM metadata WHERE key='head'").get();

    if (this.#db.prepare("SELECT value FROM metadata WHERE key='schema'").get()?.value !== "1")
      throw new Error("unsupported journal schema");

    return point(JSON.parse(text(row?.value, "journal head")));
  }

  get stats(): HistoryStats {
    const row = this.#db
      .prepare(`SELECT count(*) AS blocks,
      coalesce(sum(transactions),0) AS transactions, coalesce(sum(bytes),0) AS historyBytes FROM blocks`)
      .get();

    return {
      blocks: Number(row?.blocks),
      transactions: Number(row?.transactions),
      historyBytes: Number(row?.historyBytes),
    };
  }

  /** Return original event bytes decoded losslessly, in durable sequence order. */
  *history(): Generator<AcceptedBlock> {
    for (const row of this.#db.prepare("SELECT body FROM blocks ORDER BY sequence").iterate())
      yield decodeBlock(text(row.body, "journal body"));
  }

  intersections(): ChainPoint[] {
    const rows = this.#db.prepare("SELECT body FROM blocks ORDER BY sequence DESC LIMIT 32").all();

    return [
      ...rows.map((row) => decodeBlock(text(row.body, "journal body")).point),
      structuredClone(this.#intersection),
    ];
  }

  append(block: AcceptedBlock): void {
    const body = encode(block);

    this.#transaction(() => {
      if (!samePoint(this.head, block.parent) || block.point.slot <= block.parent.slot)
        throw new Error("journal append is not contiguous");

      this.#db
        .prepare("INSERT INTO blocks(hash,body,transactions,bytes) VALUES (?,?,?,?)")
        .run(block.point.blockHash, body, block.transactions.length, Buffer.byteLength(body));
      this.#db.prepare("UPDATE metadata SET value=? WHERE key='head'").run(encode(block.point));
    });
  }

  rollback(target: ChainPoint, expectedHead = this.head): void {
    this.#transaction(() => {
      if (!samePoint(this.head, expectedHead))
        throw new Error("journal head changed during rollback");

      const row = this.#db
        .prepare("SELECT sequence,body FROM blocks WHERE hash=?")
        .get(target.blockHash);

      if (
        !samePoint(target, this.#intersection) &&
        (!row || !samePoint(decodeBlock(text(row.body, "journal body")).point, target))
      )
        throw new Error("rollback target is outside retained history");

      this.#db
        .prepare("DELETE FROM blocks WHERE sequence>?")
        .run(samePoint(target, this.#intersection) ? 0 : Number(row?.sequence));
      this.#db.prepare("UPDATE metadata SET value=? WHERE key='head'").run(encode(target));
    });
  }

  #transaction(action: () => void): void {
    this.#db.exec("BEGIN IMMEDIATE");

    try {
      action();
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");

      throw error;
    }
  }

  close(): void {
    this.#db.close();
  }
}
