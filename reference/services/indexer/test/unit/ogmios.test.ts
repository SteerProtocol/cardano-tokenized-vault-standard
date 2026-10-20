/** Official-client protocol tests with synthetic headers/CBOR; real node acceptance remains a separate gate. */
import { rmSync } from "node:fs";
import type { Schema } from "@cardano-ogmios/client";
import { expect, it, vi } from "vitest";
import { acceptedBlock, chainPoint, synchronize, verifyGenesis } from "../../src/chain/ogmios.js";
import { Runner } from "../../src/runner.js";
import { setup } from "./fixtures.js";
import { sourceServer } from "./source-server.js";

function forward(f: ReturnType<typeof setup>) {
  return {
    direction: "forward",
    tip: { id: f.block.point.blockHash, slot: 1, height: 1 },
    block: {
      type: "praos",
      era: "conway",
      id: f.block.point.blockHash,
      ancestor: f.block.parent.blockHash,
      slot: 1,
      transactions: [{ id: f.genesis.tx.id, spends: "inputs", cbor: f.block.transactions[0] }],
    },
  };
}

it("translates empty blocks, preserves order/CBOR and rejects missing or inconsistent accepted evidence", () => {
  const f = setup();
  const raw = forward(f).block as Schema.BlockPraos;

  try {
    expect(acceptedBlock(raw, f.config.intersection)).toEqual(f.block);
    expect(acceptedBlock({ ...raw, transactions: [] }, f.config.intersection).transactions).toEqual(
      [],
    );
    expect(() =>
      acceptedBlock({ ...raw, ancestor: "ff".repeat(32) }, f.config.intersection),
    ).toThrow("ancestor");
    expect(() =>
      acceptedBlock(
        {
          ...raw,
          transactions: [{ ...raw.transactions?.[0], cbor: undefined }],
        } as unknown as Schema.Block,
        f.config.intersection,
      ),
    ).toThrow("missing");
    expect(() =>
      acceptedBlock(
        {
          ...raw,
          transactions: [{ ...raw.transactions?.[0], id: "ff".repeat(32) }],
        } as unknown as Schema.Block,
        f.config.intersection,
      ),
    ).toThrow("identity");
    expect(() => acceptedBlock({ type: "ebb" } as Schema.Block, f.config.intersection)).toThrow(
      "Byron",
    );
    expect(() => chainPoint("origin")).toThrow("origin");
    expect(() => chainPoint({ slot: 9007199254740992, id: f.block.point.blockHash })).toThrow(
      "exact",
    );
    expect(() =>
      verifyGenesis(
        { networkMagic: 43, network: "testnet", startTime: f.config.genesisStart },
        f.config,
      ),
    ).toThrow("network");
  } finally {
    rmSync(f.directory, { recursive: true });
  }
});

it("negotiates before publishing, follows rollback/replacement and reconnects through the official client", async () => {
  const f = setup();
  const source = await sourceServer(f.config);
  const config = {
    ...f.config,
    sources: { ...f.config.sources, ogmios: source.url },
    limits: { ...f.config.limits, reconnectDelayMs: 20 },
  };
  const runner = new Runner(config);
  const controller = new AbortController();

  runner.restore();
  source.push(forward(f));

  const running = synchronize(config, runner, controller.signal);

  try {
    await vi.waitFor(() => expect(runner.status().readerHead).toEqual(f.block.point));
    expect(runner.read((reader) => reader.counts.vaults)).toBe(1);
    source.push({
      direction: "backward",
      point: { slot: 0, id: f.config.intersection.blockHash },
      tip: { slot: 1, id: "bb".repeat(32), height: 1 },
    });
    await vi.waitFor(() => expect(runner.status().counts.vaults).toBe(0));
    expect(runner.status().readerReady).toBe(false);
    source.push({
      direction: "forward",
      tip: { slot: 1, id: "bb".repeat(32), height: 1 },
      block: {
        type: "praos",
        era: "conway",
        id: "bb".repeat(32),
        ancestor: f.config.intersection.blockHash,
        slot: 1,
      },
    });
    await vi.waitFor(() => expect(runner.status().readerReady).toBe(true));

    const generation = runner.status().recoveryGeneration;

    source.disconnect();
    await vi.waitFor(() => expect(runner.status().recoveryGeneration).toBeGreaterThan(generation));
    await vi.waitFor(() => expect(runner.status().readerReady).toBe(true));
  } finally {
    controller.abort();
    await running;
    runner.close();
    await source.close();
    rmSync(f.directory, { recursive: true });
  }
});

it("stops before indexing when the served network differs from the pinned genesis", async () => {
  const f = setup();
  const source = await sourceServer(f.config, 43);
  const config = { ...f.config, sources: { ...f.config.sources, ogmios: source.url } };
  const runner = new Runner(config);

  runner.restore();

  try {
    await expect(synchronize(config, runner, new AbortController().signal)).rejects.toThrow(
      "network",
    );
    expect(runner.status().history.blocks).toBe(0);
    expect(runner.status().readerReady).toBe(false);
  } finally {
    runner.close();
    await source.close();
    rmSync(f.directory, { recursive: true });
  }
});

it("detects idle chain-sync lag through an independent node-tip query", async () => {
  const f = setup();
  const source = await sourceServer(f.config);
  const config = {
    ...f.config,
    sources: { ...f.config.sources, ogmios: source.url },
    limits: { ...f.config.limits, requestTimeoutMs: 100, reconnectDelayMs: 20 },
  };
  const runner = new Runner(config);
  const controller = new AbortController();

  runner.restore();
  source.push(forward(f));

  const running = synchronize(config, runner, controller.signal);

  try {
    await vi.waitFor(() => expect(runner.status().readerReady).toBe(true));
    source.setTip({ slot: 2, id: "bb".repeat(32), height: 2 });
    await vi.waitFor(() => expect(runner.status().readerReady).toBe(false));
    expect(runner.status().observedTip?.slot).toBe(2n);
    source.push({
      direction: "forward",
      tip: { slot: 2, id: "bb".repeat(32), height: 2 },
      block: {
        type: "praos",
        era: "conway",
        slot: 2,
        id: "bb".repeat(32),
        ancestor: f.block.point.blockHash,
      },
    });
    await vi.waitFor(() => expect(runner.status().readerReady).toBe(true));
  } finally {
    controller.abort();
    await running;
    runner.close();
    await source.close();
    rmSync(f.directory, { recursive: true });
  }
});

it("withdraws readiness when a live WebSocket stops answering the node-tip heartbeat", async () => {
  const f = setup();
  const source = await sourceServer(f.config);
  const config = {
    ...f.config,
    sources: { ...f.config.sources, ogmios: source.url },
    limits: { ...f.config.limits, requestTimeoutMs: 100, reconnectDelayMs: 1000 },
  };
  const runner = new Runner(config);
  const controller = new AbortController();

  runner.restore();
  source.push(forward(f));

  const running = synchronize(config, runner, controller.signal);

  try {
    await vi.waitFor(() => expect(runner.status().readerReady).toBe(true));
    source.silenceTip();
    await vi.waitFor(() => expect(runner.status().phase).toBe("disconnected"));
    expect(runner.status().readerReady).toBe(false);
    expect(runner.status().durableHead).toEqual(f.block.point);
  } finally {
    controller.abort();
    await running;
    runner.close();
    await source.close();
    rmSync(f.directory, { recursive: true });
  }
});

it("reconnects when the socket closes while an independent tip query is outstanding", async () => {
  const f = setup();
  const source = await sourceServer(f.config);
  const config = {
    ...f.config,
    sources: { ...f.config.sources, ogmios: source.url },
    limits: { ...f.config.limits, requestTimeoutMs: 200, reconnectDelayMs: 20 },
  };
  const runner = new Runner(config);
  const controller = new AbortController();

  runner.restore();
  source.push(forward(f));

  const running = synchronize(config, runner, controller.signal);

  try {
    await vi.waitFor(() => expect(runner.status().readerReady).toBe(true));

    const generation = runner.status().recoveryGeneration;

    source.silenceTip();
    await vi.waitFor(() => expect(source.tipQueries).toBeGreaterThan(0));
    source.disconnect();
    source.resumeTip();
    await vi.waitFor(() => expect(runner.status().recoveryGeneration).toBeGreaterThan(generation));
    await vi.waitFor(() => expect(runner.status().readerReady).toBe(true));
  } finally {
    controller.abort();
    await running;
    runner.close();
    await source.close();
    rmSync(f.directory, { recursive: true });
  }
});
