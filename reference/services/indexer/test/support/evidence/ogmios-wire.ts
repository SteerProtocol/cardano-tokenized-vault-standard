/** Inspect exact relayed messages without reconstructing accepted transaction bytes. */
import assert from "node:assert/strict";
import { type Schema, safeJSON } from "@cardano-ogmios/client";
import { expect } from "vitest";
export interface RelaySession {
  id: number;
  messages: { direction: "request" | "response"; wire: string }[];
}


export interface G1Rpc {
  method: string;
  id: unknown;
  params?: { points: { slot: number; id: string }[] };
  result?: {
    intersection?: { slot: number; id: string };
    tip?: Schema.Tip;
    direction?: "forward" | "backward";
    block?: Schema.BlockPraos;
    point?: Schema.Point;
  };
  error?: { code: number; message: string };
}

export function rpc(wire: string): G1Rpc {
  return safeJSON.parse(wire) as G1Rpc;
}

export function negotiation(session: RelaySession) {
  const request = session.messages.find(
    (row) => row.direction === "request" && rpc(row.wire).method === "findIntersection",
  );

  assert.ok(request);

  const proposed = rpc(request.wire);
  const response = session.messages.find(
    (row) =>
      row.direction === "response" &&
      JSON.stringify(rpc(row.wire).id) === JSON.stringify(proposed.id),
  );

  assert.ok(response);

  return { proposed, response: rpc(response.wire) };
}

export function wireOrder(sessions: RelaySession[]) {
  for (const session of sessions) {
    let outstanding = 0;
    let intersected = false;

    for (const row of session.messages) {
      const value = rpc(row.wire);

      if (row.direction === "response" && value.method === "findIntersection" && !value.error)
        intersected = true;

      if (value.method !== "nextBlock") continue;

      expect(intersected).toBe(true);
      outstanding += row.direction === "request" ? 1 : -1;
      expect(outstanding).toBeGreaterThanOrEqual(0);
      expect(outstanding).toBeLessThanOrEqual(1);
    }
  }
}
