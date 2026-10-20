/** Corrupted real-response variants must fail through the official client before advancing SQLite or reader state. */
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { synchronize } from "../../src/chain/ogmios.js";
import { Runner } from "../../src/runner.js";
import { g1Cases, g1Disk, g1Setup } from "./g1-fixture.js";
import { type FaultReply, g1Faults } from "./g1-malformed.js";
import { sourceServer } from "./source-server.js";

const cases = g1Cases.flatMap((sample) =>
  g1Faults.map((fault) => ({ ...sample, fault, label: `${sample.label} ${fault.name}` })),
);

it.each(cases)("refuses $label without partial head advancement", async ({ fixture, fault }) => {
  const f = g1Setup(fixture);

  f.runner.close();

  const source = await sourceServer(f.config);
  const config = { ...f.config, sources: { ...f.config.sources, ogmios: source.url } };
  const runner = new Runner(config);

  runner.restore();

  const controller = new AbortController();
  const original = fixture.wire[0];

  assert.ok(original);

  const events = original.messages
    .filter((m) => m.direction === "response")
    .map(
      (m) =>
        JSON.parse(m.wire) as { method: string; result?: { direction?: string; block?: unknown } },
    )
    .filter((m) => m.method === "nextBlock" && m.result?.direction === "forward")
    .map((m) => m.result as unknown as FaultReply);
  const target = events.findIndex((event) =>
    fixture.expected.multiple.every((row) =>
      event.block.transactions?.some((tx) => tx.id === row.txId),
    ),
  );

  assert.ok(target > 0);

  for (const event of events.slice(0, target)) source.push(event);

  const running = synchronize(config, runner, controller.signal);
  const completion = running.then(
    () => null,
    (error: unknown) => error,
  );

  try {
    const previous = events[target - 1];

    assert.ok(previous);
    await vi.waitFor(() => expect(runner.status().readerHead.blockHash).toBe(previous.block.id));

    const before = runner.status();
    const history = g1Disk(config.database);
    const malformed = structuredClone(events[target]);

    assert.ok(malformed);
    fault.change(malformed, Number(before.readerHead.slot));
    source.push(malformed);
    await vi.waitFor(() => expect(runner.status().phase).toBe("failed"));
    expect(await completion).toBeInstanceOf(Error);
    expect(runner.status().readerReady).toBe(false);
    expect(runner.status().readerHead).toEqual(before.readerHead);
    expect(runner.status().durableHead).toEqual(before.durableHead);
    expect(runner.status().counts).toEqual(before.counts);
    expect(g1Disk(config.database)).toEqual(history);
    expect(() => runner.read((reader) => reader.counts)).toThrow("not ready");
  } finally {
    controller.abort();
    await completion;
    runner.close();
    await source.close();
    rmSync(f.directory, { recursive: true });
  }
});
