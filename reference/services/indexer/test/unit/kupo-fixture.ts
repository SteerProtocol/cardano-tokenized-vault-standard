/** Deterministic pinned-server responses for commit/header races and readiness invalidation. */
import type { ChainPoint } from "@ctvs/planning";
import { vi } from "vitest";
import { KupoReconciliation, type LookupTarget } from "../../src/chain/kupo-reconciliation.js";
import { setup } from "./fixtures.js";

export function kupoFixture() {
  const f = setup();

  f.config.kupoCoverage = { since: "origin", match: "*", spent: "retain" };

  const target: LookupTarget = {
    instance: "test-service",
    recoveryGeneration: 2,
    point: f.block.point,
  };

  return { ...f, target, reconciliation: new KupoReconciliation(f.config) };
}

export function response(path: string, point: ChainPoint): Response {
  const value =
    path === "/health"
      ? {
          version: "v2.12.0+491918",
          connection_status: "connected",
          most_recent_checkpoint: Number(point.slot),
          most_recent_node_tip: Number(point.slot),
        }
      : path === "/patterns"
        ? ["*"]
        : [{ slot_no: Number(point.slot), header_hash: point.blockHash }];

  return new Response(JSON.stringify(value), {
    headers: {
      "Content-Type": "application/json",
      ETag: point.blockHash,
      "X-Most-Recent-Checkpoint": point.slot.toString(),
    },
  });
}

export function transport(
  point: ChainPoint,
  change?: (path: string, result: Response, call: number) => Promise<Response>,
) {
  let call = 0;
  const fetcher = vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
    const path = new URL(String(input)).pathname;

    if (options?.signal?.aborted) throw new Error("aborted");

    const result = response(path, point);

    return change ? change(path, result, ++call) : result;
  });

  vi.stubGlobal("fetch", fetcher);

  return fetcher;
}

export const active = () => new AbortController().signal;
