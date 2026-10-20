/** Ephemeral readiness observations belong to the service, never to HTTP client instances or the journal. */
import { performance } from "node:perf_hooks";
import type { ChainPoint } from "@ctvs/planning";
import type { IndexerConfig } from "../config.js";
import { samePoint } from "../storage/journal.js";
import { probeKupo } from "./kupo-probe.js";

export interface LookupTarget {
  instance: string;
  recoveryGeneration: number;
  point: ChainPoint;
}

function matches(a: LookupTarget | null, b: LookupTarget | null): boolean {
  return Boolean(
    a &&
      b &&
      a.instance === b.instance &&
      a.recoveryGeneration === b.recoveryGeneration &&
      samePoint(a.point, b.point),
  );
}

export class KupoReconciliation {
  readonly #config: IndexerConfig;
  #target: LookupTarget | null = null;
  #started = -Infinity;
  #checkedAt: string | null = null;
  #reachable = false;
  #reason = "not_checked";
  #revision = 0;

  constructor(config: IndexerConfig) {
    this.#config = structuredClone(config);
  }

  async check(target: LookupTarget | null, parent: AbortSignal): Promise<void> {
    const revision = ++this.#revision;
    const started = performance.now();
    const checkedAt = new Date().toISOString();
    const captured = structuredClone(target);
    const signal = AbortSignal.any([
      parent,
      AbortSignal.timeout(this.#config.limits.requestTimeoutMs),
    ]);

    this.#reason = "checking";
    this.#target = null;

    const result = await probeKupo(this.#config, captured?.point ?? null, signal);

    if (revision !== this.#revision) return;

    this.#target = captured;
    this.#started = started;
    this.#checkedAt = checkedAt;
    this.#reachable = result.reachable;
    this.#reason = signal.aborted ? "probe_aborted" : result.reason;
  }

  status(target: LookupTarget | null) {
    const reason =
      this.#reason !== "reconciled"
        ? this.#reason
        : !matches(target, this.#target)
          ? "reader_changed"
          : performance.now() - this.#started >= this.#config.limits.lookupMaxAgeMs
            ? "observation_expired"
            : "reconciled";

    return structuredClone({
      reachable: this.#reachable,
      verification: reason === "reconciled" ? ("verified" as const) : ("unverified" as const),
      reason,
      coverage: this.#config.kupoCoverage ? "operator_declared" : "undeclared",
      checkedAt: this.#checkedAt,
      maxAgeMs: this.#config.limits.lookupMaxAgeMs,
      basis: this.#target,
    });
  }
}
