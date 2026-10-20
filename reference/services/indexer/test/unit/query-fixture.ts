/** Local synthetic query host shared by SDK and caller-side planner tests. */
import { rmSync } from "node:fs";
import { createIndexerClient } from "@ctvs/integration/client";
import { QUERY_VERSION } from "@ctvs/integration/query";
import type { TransactionPlan } from "@ctvs/planning";
import { afterEach, vi } from "vitest";
import { Runner } from "../../src/runner.js";
import { closeServer, statusServer } from "../../src/server.js";
import { setup } from "./fixtures.js";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const action of cleanups.splice(0).reverse()) await action();
});

export async function queryFixture(family: "ctvs1" | "ctvs2" = "ctvs2", selected = false) {
  const f = setup(family);

  if (selected) f.config.tracking = { mode: "selected", vaults: [f.policy] };

  const runner = new Runner(f.config);

  runner.restore();

  const server = await statusServer({ ...f.config, http: { host: "127.0.0.1", port: 0 } }, runner);
  const location = server.address();

  if (!location || typeof location === "string") throw new Error("no listener");

  const url = `http://127.0.0.1:${location.port}`;
  const transport = vi.fn(globalThis.fetch);
  const client = createIndexerClient({
    baseUrl: url,
    expectedNetwork: f.config.network,
    fetch: transport,
  });

  cleanups.push(async () => {
    await closeServer(server);
    runner.close();
    rmSync(f.directory, { recursive: true });
  });

  const sync = () => {
    runner.intersect(f.config.intersection, f.block.point);
    runner.forward(f.block, f.block.point);
  };

  const post = (queries: unknown) =>
    fetch(`${url}/v1/vaults/${f.policy}/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiVersion: QUERY_VERSION, queries }),
    });

  return {
    ...f,
    runner,
    client,
    transport,
    url,
    sync,
    post,
    accept: (plan: TransactionPlan) => {
      const event = f.append(plan);

      runner.forward(event.block, event.block.point);

      return event;
    },
  };
}
