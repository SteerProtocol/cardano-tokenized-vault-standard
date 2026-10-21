/** Serial durable host: validate privately, commit history, publish, then allow synchronous reads. */
import { randomUUID } from "node:crypto";
import { type AcceptedBlock, type ReaderCounts, VaultReader } from "@ctvs/integration";
import type { ChainPoint } from "@ctvs/planning";
import { KupoReconciliation, type LookupTarget } from "./chain/kupo-reconciliation.js";
import { type IndexerConfig, journalIdentity } from "./config.js";
import { encode, Journal, samePoint } from "./storage/journal.js";

type Phase =
  | "replaying"
  | "connecting"
  | "catching_up"
  | "ready"
  | "disconnected"
  | "failed"
  | "stopped";
type ReaderView = Pick<
  VaultReader,
  | "chainPoint"
  | "counts"
  | "discover"
  | "snapshot"
  | "quote"
  | "request"
  | "claim"
  | "ownership"
  | "context"
  | "recoverySource"
  | "effects"
  | "convertToAssets"
  | "convertToShares"
  | "previewDeposit"
  | "previewMint"
  | "previewWithdraw"
  | "previewRedeem"
  | "constructionContext"
  | "requestView"
  | "claimView"
>;

export class Runner {
  readonly kupo: KupoReconciliation;
  readonly #config: IndexerConfig;
  readonly #journal: Journal;
  readonly #reader: VaultReader;
  readonly #instance = randomUUID();
  #generation = 0;
  #phase: Phase = "replaying";
  #tip: ChainPoint | null = null;
  #error: string | null = null;

  constructor(
    config: IndexerConfig,
    journal = new Journal(config.database, journalIdentity(config), config.intersection),
  ) {
    this.#config = structuredClone(config);
    this.kupo = new KupoReconciliation(config);
    this.#journal = journal;
    this.#reader = new VaultReader(
      config.network,
      config.reviewedBuilds,
      config.intersection,
      config.tracking.mode === "selected" ? { vaultPolicies: config.tracking.vaults } : {},
    );
  }

  /** Replay privately; a matching live intersection is still required before serving results. */
  restore(): void {
    try {
      const stats = this.#journal.stats;

      if (
        stats.blocks > this.#config.limits.maxBlocks ||
        stats.historyBytes > this.#config.limits.maxHistoryBytes
      )
        throw new Error("retained history exceeds configured workload");

      for (const block of this.#journal.history()) {
        this.#checkEvent(block);

        const update = this.#reader.prepareForward(block);

        this.#checkProjection(update.counts);
        update.publish();
      }

      if (!samePoint(this.#reader.chainPoint, this.#journal.head))
        throw new Error("journal head disagrees with retained history");

      this.#phase = "connecting";
    } catch (error) {
      this.fail(error);

      throw error;
    }
  }

  intersections(): ChainPoint[] {
    return this.#journal.intersections();
  }

  /** Every connection must explicitly reconcile its selected intersection, even when it equals the old head. */
  intersect(selected: ChainPoint, tip: ChainPoint): void {
    if (this.#phase === "failed" || this.#phase === "stopped" || this.#phase === "replaying")
      throw new Error("runner cannot reconcile in its current phase");

    this.#generation++;
    this.#phase = "catching_up";
    this.backward(selected, tip);
  }

  forward(block: AcceptedBlock, tip: ChainPoint): void {
    try {
      this.#requireSession();
      this.#checkEvent(block);
      this.#validateTip(tip, block.point);

      const stats = this.#journal.stats;

      if (
        stats.historyBytes + Buffer.byteLength(encode(block)) >
        this.#config.limits.maxHistoryBytes
      )
        throw new Error("history byte budget exceeded");

      const update = this.#reader.prepareForward(block);

      this.#checkProjection(update.counts);
      this.#journal.append(block);
      update.publish();
      this.#progress(tip);
    } catch (error) {
      this.fail(error);

      throw error;
    }
  }

  backward(target: ChainPoint, tip: ChainPoint): void {
    this.#requireSession();
    this.#phase = "catching_up";
    this.#generation++;

    try {
      this.#validateTip(tip, target);

      const update = this.#reader.prepareBackward(target);

      this.#journal.rollback(target, this.#reader.chainPoint);
      update.publish();
      this.#tip = null;
      this.#progress(tip);
    } catch (error) {
      this.fail(error);

      throw error;
    }
  }

  #checkEvent(block: AcceptedBlock): void {
    const size = block.transactions.reduce((sum, tx) => sum + tx.length / 2, 0);

    if (size > this.#config.limits.maxBlockBytes) throw new Error("block byte budget exceeded");
  }

  #requireSession(): void {
    if (this.#phase !== "ready" && this.#phase !== "catching_up")
      throw new Error("chain session has not reconciled its intersection");
  }

  /** An independent node-tip heartbeat may reveal lag or a fork before a backward event arrives. */
  observeTip(tip: ChainPoint): boolean {
    this.#requireSession();

    const head = this.#reader.chainPoint;

    if (
      tip.slot < head.slot ||
      (tip.slot === head.slot && tip.blockHash !== head.blockHash) ||
      (this.#tip && tip.slot < this.#tip.slot)
    ) {
      this.#tip = structuredClone(tip);
      this.disconnect();

      return false;
    }

    this.#progress(tip);

    return true;
  }

  #checkProjection(counts: Readonly<ReaderCounts>): void {
    const limits = this.#config.limits;

    if (
      counts.blocks > limits.maxBlocks ||
      counts.transactions > limits.maxTransactions ||
      counts.utxos > limits.maxUtxos ||
      counts.vaults + counts.requests + counts.claims > limits.maxRecords
    )
      throw new Error("reader workload budget exceeded");
  }

  #validateTip(tip: ChainPoint, head: ChainPoint): void {
    if (tip.slot < head.slot || (tip.slot === head.slot && tip.blockHash !== head.blockHash))
      throw new Error("source tip conflicts with reader head");
  }

  #progress(tip: ChainPoint): void {
    const head = this.#reader.chainPoint;

    if (this.#tip && this.#tip.slot > tip.slot) tip = this.#tip;

    this.#tip = structuredClone(tip);
    this.#error = null;
    this.#phase =
      tip.slot - head.slot <= BigInt(this.#config.limits.maxLagSlots) ? "ready" : "catching_up";
  }

  /** All work in a combined read is synchronous against one published view; no network awaits are permitted. */
  read<T>(query: (reader: ReaderView) => T): T {
    if (this.#phase !== "ready" || !samePoint(this.#reader.chainPoint, this.#journal.head))
      throw new Error("reader is not ready");

    const result = query(this.#reader);

    if (result instanceof Promise) throw new Error("reader queries must be synchronous");

    return result;
  }

  disconnect(): void {
    if (this.#phase !== "failed" && this.#phase !== "stopped") this.#phase = "disconnected";

    this.#generation++;
  }

  fail(error: unknown): void {
    this.#phase = "failed";
    this.#error = error instanceof Error ? error.message : "indexer failed";
    this.#generation++;
  }

  /** Lookups require the exact independently observed tip even when reader lag tolerance is nonzero. */
  lookupTarget(): LookupTarget | null {
    const head = this.#reader.chainPoint;

    if (
      this.#phase !== "ready" ||
      !samePoint(head, this.#journal.head) ||
      !this.#tip ||
      !samePoint(head, this.#tip)
    )
      return null;

    return { instance: this.#instance, recoveryGeneration: this.#generation, point: head };
  }

  status() {
    const durableHead = this.#journal.head;
    const readerHead = this.#reader.chainPoint;
    const kupo = this.kupo.status(this.lookupTarget());

    return structuredClone({
      phase: this.#phase,
      readerReady: this.#phase === "ready" && samePoint(durableHead, readerHead),
      lookupReady: kupo.verification === "verified",
      kupo,
      instance: this.#instance,
      recoveryGeneration: this.#generation,
      error: this.#error,
      network: this.#config.network,
      tracking: this.#config.tracking,
      bootstrap: this.#config.intersection,
      durableHead,
      readerHead,
      observedTip: this.#tip,
      counts: this.#reader.counts,
      history: this.#journal.stats,
      limits: this.#config.limits,
    });
  }

  close(): void {
    if (this.#phase === "stopped") return;

    this.#phase = "stopped";
    this.#journal.close();
  }
}
