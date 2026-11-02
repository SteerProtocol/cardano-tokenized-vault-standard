/** Kupo 2.12 probes compare committed database payloads, not just pre-transaction health headers. */
import type { ChainPoint } from "@ctvs/planning";
import { type IndexerConfig, object, unsigned } from "../config.js";
import { samePoint } from "../storage/journal.js";

const responseBytes = 65536;

class ProbeError extends Error {}

function requireMatch(matches: boolean, reason: string): void {
  if (!matches) throw new ProbeError(reason);
}

async function json(response: Response): Promise<unknown> {
  if (!(Number(response.headers.get("content-length")) <= responseBytes)) {
    await response.body?.cancel();

    throw new ProbeError("response_limit");
  }

  const reader = response.body?.getReader();

  if (!reader) throw new ProbeError("invalid_response");

  const parts: Uint8Array[] = [];
  let size = 0;

  try {
    for (;;) {
      const part = await reader.read();

      if (part.done) break;

      size += part.value.length;
      requireMatch(size <= responseBytes, "response_limit");
      parts.push(part.value);
    }

    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts)));
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

function headers(response: Response, point: ChainPoint): void {
  requireMatch(
    response.headers.get("x-most-recent-checkpoint") === point.slot.toString() &&
      response.headers.get("etag") === point.blockHash,
    "header_point_mismatch",
  );
}

function health(value: unknown, point: ChainPoint): void {
  const raw = object(value, "Kupo health");

  requireMatch(raw.version === "v2.12.0+491918", "unsupported_version");
  requireMatch(raw.connection_status === "connected", "kupo_disconnected");
  requireMatch(
    BigInt(unsigned(raw.most_recent_checkpoint, "Kupo checkpoint")) === point.slot &&
      BigInt(unsigned(raw.most_recent_node_tip, "Kupo node tip")) === point.slot,
    "health_point_mismatch",
  );
}

function checkpoint(value: unknown, point: ChainPoint): void {
  requireMatch(Array.isArray(value) && value.length > 0, "missing_checkpoint");

  const raw = object((value as unknown[])[0], "Kupo database checkpoint");

  requireMatch(
    samePoint(
      {
        slot: BigInt(unsigned(raw.slot_no, "Kupo database slot")),
        blockHash: String(raw.header_hash),
      },
      point,
    ),
    "database_point_mismatch",
  );
}

/** One deadline bounds the entire bracket. No redirects, conditional requests or unbounded bodies. */
export async function probeKupo(
  config: IndexerConfig,
  point: ChainPoint | null,
  signal: AbortSignal,
) {
  let reachable = false;

  const get = async (path: string, check?: (value: unknown) => void) => {
    let response: Response;

    try {
      response = await fetch(`${config.sources.kupo}${path}`, {
        signal,
        redirect: "error",
        cache: "no-store",
        headers: { Accept: "application/json;asset-quantity=string" },
      });
    } catch {
      reachable = false;

      throw new ProbeError("transport_unavailable");
    }

    reachable = true;

    if (response.status !== 200) {
      await response.body?.cancel();

      throw new ProbeError("http_unavailable");
    }

    const value = await json(response);

    if (point && check) {
      headers(response, point);
      check(value);
    }

    return value;
  };

  try {
    await get("/health", (value) => health(value, point as ChainPoint));
    requireMatch(config.kupoCoverage !== null, "coverage_undeclared");
    requireMatch(point !== null, "reader_not_current");

    const expected = point as ChainPoint;

    await get("/checkpoints", (value) => checkpoint(value, expected));

    const patterns = await get("/patterns");

    requireMatch(
      Array.isArray(patterns) && patterns.length === 1 && patterns[0] === "*",
      "coverage_mismatch",
    );
    await get("/checkpoints", (value) => checkpoint(value, expected));
    await get("/health", (value) => health(value, expected));

    return { reachable, reason: "reconciled" };
  } catch (error) {
    return { reachable, reason: error instanceof ProbeError ? error.message : "invalid_response" };
  }
}
