/** Reuse Kupmios with exact string quantities. Reachability alone never grants point-compatible lookup readiness. */
import { Kupmios } from "@lucid-evolution/lucid";
import type { IndexerConfig } from "../config.js";

export function createProvider(config: IndexerConfig): Kupmios {
  return new Kupmios(config.sources.kupo, config.sources.ogmios, {
    // The pinned server recognizes the semicolon media parameter; a colon silently returns numeric quantities.
    kupoHeader: { Accept: "application/json;asset-quantity=string" },
    requestTimeoutMs: config.limits.requestTimeoutMs,
  });
}

/** Transport diagnostic only. Service readiness uses the bounded checkpoint reconciler. */
export async function kupoReachable(config: IndexerConfig, signal?: AbortSignal): Promise<boolean> {
  try {
    const timeout = AbortSignal.timeout(config.limits.requestTimeoutMs);
    const response = await fetch(`${config.sources.kupo}/health`, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });

    await response.arrayBuffer();

    return response.ok;
  } catch {
    return false;
  }
}
