/** Exercise the exported SDK over actual local HTTP, independent of Kupo reachability. */
import { createIndexerClient, QueryError } from "@ctvs/integration/client";
import { QUERY_BUDGET, type ReadQueries } from "@ctvs/integration/query";
import { expect, it } from "vitest";
import { Runner } from "../../src/runner.js";
import { closeServer, statusServer } from "../../src/server.js";
import { queryFixture } from "./query-fixture.js";

it.each(["ctvs1", "ctvs2"] as const)(
  "exposes all six %s methods and one-request combined reads",
  async (family) => {
    const f = await queryFixture(family);
    const vault = f.client.vault(f.policy);

    await expect(vault.snapshot()).rejects.toMatchObject({ code: "READER_NOT_READY", status: 503 });
    f.sync();
    expect((await vault.convertToAssets({ shares: 101000n })).data.result).toEqual({
      status: "known",
      value: 101000n,
    });
    expect((await vault.convertToShares({ assets: 9007199254740993n })).data.result).toEqual({
      status: "known",
      value: 9007199254740993n,
    });
    expect((await vault.previewDeposit({ assets: 101000n })).data.result).toEqual({
      status: "known",
      value: 100000n,
    });
    expect((await vault.previewMint({ shares: 100000n })).data.result).toEqual({
      status: "known",
      value: 101000n,
    });
    expect((await vault.previewWithdraw({ assets: 100000n })).data.result).toEqual({
      status: "known",
      value: 101000n,
    });
    expect((await vault.previewRedeem({ shares: 101000n })).data.result).toEqual({
      status: "known",
      value: 100000n,
    });
    f.transport.mockClear();

    const view = await vault.read({
      snapshot: true,
      previewDeposit: { assets: 101000n, include: ["construction"] },
      ownership: { address: f.owner },
      context: true,
    });

    expect(f.transport).toHaveBeenCalledOnce();
    expect(view.data.context.stateInput.ref).toEqual(view.basis.stateRef);
    expect(view.data.previewDeposit.construction?.stateInput.ref).toEqual(view.basis.stateRef);
    expect(view.data.ownership.freeShares).toBe(0n);
    expect((await f.client.discover(`${f.policy}.5348415245`)).vault.policy).toBe(f.policy);
    expect(f.runner.status().lookupReady).toBe(false);
  },
);

it("rejects stale bases, malformed requests and outside-scope reads without partial results", async () => {
  const f = await queryFixture("ctvs2", true);

  f.sync();

  const vault = f.client.vault(f.policy);
  const original = await vault.snapshot();
  const empty = {
    parent: f.block.point,
    point: { slot: 2n, blockHash: "cd".repeat(32) },
    transactions: [],
  };

  f.runner.forward(empty, empty.point);
  await expect(
    vault.read({ snapshot: true }, { expectedBasis: original.basis }),
  ).rejects.toMatchObject({ code: "STALE_BASIS" });
  await expect(f.client.vault("ff".repeat(28)).snapshot()).rejects.toMatchObject({
    code: "OUTSIDE_SCOPE",
  });

  const bad = await f.post({ snapshot: true, previewDeposit: { assets: "-1" } });

  expect(bad.status).toBe(400);
  expect(await bad.json()).not.toHaveProperty("data");

  const missing = await f.post({
    snapshot: true,
    request: { ref: { txId: "aa".repeat(32), index: "0" } },
  });

  expect(missing.status).toBe(404);
  expect(await missing.json()).not.toHaveProperty("data");
  await expect(vault.previewMint({ shares: 1n, include: ["construction"] })).rejects.toMatchObject({
    code: "UNSUPPORTED_CONSTRUCTION",
  });
  expect((await fetch(`${f.url}/v1/unknown`)).status).toBe(404);
  expect((await fetch(`${f.url}/health/live`)).status).toBe(200);
  expect((await fetch(`${f.url}/v1/vaults/${f.policy}/read`)).status).toBe(405);
  f.runner.disconnect();
  await expect(vault.context()).rejects.toBeInstanceOf(QueryError);
});

it("replays the journal into a new host and rejects the previous instance's basis", async () => {
  const f = await queryFixture();

  f.sync();

  const before = await f.client.vault(f.policy).read({ snapshot: true, context: true });

  f.runner.disconnect();

  const runner = new Runner(f.config);

  runner.restore();

  const server = await statusServer({ ...f.config, http: { host: "127.0.0.1", port: 0 } }, runner);

  try {
    const listener = server.address();

    if (!listener || typeof listener === "string") throw new Error("no listener");

    const client = createIndexerClient({
      baseUrl: `http://127.0.0.1:${listener.port}`,
      expectedNetwork: f.config.network,
    });
    const vault = client.vault(f.policy);

    await expect(vault.snapshot()).rejects.toMatchObject({ code: "READER_NOT_READY" });
    runner.intersect(f.block.point, f.block.point);

    const replayed = await vault.read({ snapshot: true, context: true });

    expect(replayed.data).toEqual(before.data);
    expect(replayed.chainPoint).toEqual(before.chainPoint);
    expect(replayed.basis.instance).not.toBe(before.basis.instance);
    await expect(
      vault.read({ snapshot: true }, { expectedBasis: before.basis }),
    ).rejects.toMatchObject({ code: "STALE_BASIS" });
  } finally {
    await closeServer(server);
    runner.close();
  }
});

it("rejects invalid SDK inputs before fetching and refuses oversized or invalid HTTP bodies", async () => {
  const f = await queryFixture();

  f.sync();
  await expect(
    f.client.vault(f.policy).read({ unknown: true } as ReadQueries),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  expect(f.transport).not.toHaveBeenCalled();

  const malformed = await fetch(`${f.url}/v1/vaults/${f.policy}/read`, {
    method: "POST",
    body: "{}",
  });

  expect(malformed.status).toBe(415);

  const oversized = await f.post({ snapshot: true, excess: "x".repeat(QUERY_BUDGET.bodyBytes) });

  expect(oversized.status).toBe(413);
});
