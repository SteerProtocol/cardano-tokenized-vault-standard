/** The live corpus covers ordered bytes, lossless collateral-only effects and explicit reconnection rollback. */
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { dispatchRead, type NetworkBinding, readAcceptedTransaction } from "@ctvs/integration";
import { decodeQueryResponse, decodeReadRequest, ECONOMIC_METHODS } from "@ctvs/integration/query";
import { NAMES } from "@ctvs/protocol";
import { expect, it } from "vitest";
import { acceptedBlock } from "../../src/chain/ogmios.js";
import { negotiation, rpc, wireOrder } from "../support/evidence/ogmios-wire.js";
import { g1ApplySession, g1Cases, g1Disk, g1Sessions, g1Setup } from "./g1-fixture.js";

it.each(g1Cases)("replays all real $label sessions and complete HTTP responses", ({ fixture }) => {
  const f = g1Setup(fixture);
  const seen = new Set<string>();

  try {
    for (const session of g1Sessions(fixture).filter((row) =>
      fixture.daemonSessions.includes(row.id),
    )) {
      expect(negotiation(session).proposed.params?.points).toEqual(
        f.runner.intersections().map((p) => ({ slot: Number(p.slot), id: p.blockHash })),
      );
      g1ApplySession(f.runner, session, () => {
        if (!f.runner.status().readerReady) return;

        for (const checkpoint of fixture.checkpoints.filter(
          (row) =>
            row.response.basis.chainPoint.blockHash === f.runner.status().readerHead.blockHash,
        )) {
          const request = decodeReadRequest(checkpoint.request);
          const response = decodeQueryResponse(
            checkpoint.response,
            request.queries,
            fixture.expected.policy,
            fixture.configuration.network as NetworkBinding,
          );

          expect(
            f.runner.read((reader) =>
              dispatchRead(reader, fixture.expected.policy, request, response.basis),
            ),
          ).toEqual(response);
          seen.add(checkpoint.label);
        }
      });
    }

    expect(seen.size).toBe(fixture.checkpoints.length);
    expect(g1Disk(f.config.database)).toEqual(fixture.blocks);

    const last = fixture.blocks.at(-1);

    assert.ok(last);
    expect(f.runner.status().readerHead).toEqual({ ...last.point, slot: BigInt(last.point.slot) });
    wireOrder(g1Sessions(fixture));
  } finally {
    f.runner.close();
    rmSync(f.directory, { recursive: true });
  }
});

it.each(g1Cases)(
  "preserves real $label block order, empty blocks and skipped slots",
  ({ fixture }) => {
    const original = fixture.wire[0];

    assert.ok(original);

    const blocks = original.messages
      .filter((m) => m.direction === "response")
      .map((m) => rpc(m.wire).result)
      .filter((r) => r?.direction === "forward");

    expect(
      blocks.some(
        (r) => r?.block?.transactions?.length === 0 || r?.block?.transactions === undefined,
      ),
    ).toBe(true);
    expect(
      blocks.some(
        (r, index) =>
          index > 0 && Number(r?.block?.slot) - Number(blocks[index - 1]?.block?.slot) > 1,
      ),
    ).toBe(true);

    const multiple = blocks.find((r) =>
      fixture.expected.multiple.every((tx) =>
        r?.block?.transactions?.some((t) => t.id === tx.txId),
      ),
    );

    assert.ok(multiple?.block);

    const converted = acceptedBlock(multiple.block, {
      slot: 0n,
      blockHash: multiple.block.ancestor,
    });

    expect(converted.transactions).toEqual(multiple.block.transactions?.map((t) => t.cbor));
    expect(converted.transactions.map((cbor) => readAcceptedTransaction(cbor).id)).toEqual(
      multiple.block.transactions?.map((t) => t.id),
    );
  },
);

it.each(g1Cases)("applies only actual included $label collateral effects", ({ fixture }) => {
  const tx = readAcceptedTransaction(fixture.expected.invalidCbor);

  expect(tx.id).toBe(fixture.expected.invalidTxId);
  expect(tx.valid).toBe(false);
  expect(tx.inputs).toEqual([
    {
      ...fixture.expected.collateralSource,
      index: BigInt(fixture.expected.collateralSource.index),
    },
  ]);
  expect(tx.spends.size).toBe(0);
  expect(tx.outputs).toHaveLength(1);
  expect(tx.outputs[0]?.ref).toEqual({
    ...fixture.expected.returnRef,
    index: BigInt(fixture.expected.returnRef.index),
  });
  expect(tx.outputs[0]?.value).toEqual(
    Object.fromEntries(
      Object.entries(fixture.expected.returnValue).map(([k, v]) => [k, BigInt(v)]),
    ),
  );
  expect(tx.outputs[0]?.value[`${fixture.expected.policy}.${NAMES.share}`]).toBe(1000000n);
  expect(Object.values(tx.outputs[0]?.value ?? {})).toContain(9007199254740993n);
  expect(readAcceptedTransaction(fixture.expected.validIntentCbor).valid).toBe(true);
  expect(readAcceptedTransaction(fixture.expected.validIntentCbor).id).toBe(tx.id);

  const raw = fixture.wire
    .flatMap((s) => s.messages)
    .filter((m) => m.direction === "response")
    .flatMap((m) => rpc(m.wire).result?.block?.transactions ?? [])
    .find((t) => t.id === tx.id);

  expect(raw?.spends).toBe("collaterals");
  expect(raw?.cbor).toBe(fixture.expected.invalidCbor);
});

it.each(g1Cases)(
  "restores $label accounting after negotiating an older real fork point",
  ({ fixture }) => {
    const final = fixture.checkpoints.find((c) => c.label === "g1-fork-reconnect-after");

    assert.ok(final);
    expect(final.response.data.snapshot.state).toMatchObject({
      sequence: "1",
      backingAssets: "100000000",
      economicSupply: "100000000",
      accruedFees: "1000000",
      storageLovelace: "10000000",
      pauseFlags: "0",
    });
    expect(final.response.data.ownership.freeShares).toBe("99000000");

    const values = {
      convertToAssets: "10000000",
      convertToShares: "10000000",
      previewDeposit: "100000000",
      previewMint: "101000000",
      previewWithdraw: "9999000",
      previewRedeem: "9900990",
    };

    for (const method of ECONOMIC_METHODS)
      expect(final.response.data[method].result).toEqual({
        status: "known",
        value: values[method],
      });

    const forkSession = g1Sessions(fixture)[3];

    assert.ok(forkSession);

    const intersection = negotiation(forkSession).response.result?.intersection;

    expect(intersection).toEqual({
      slot: Number(fixture.expected.common.slot),
      id: fixture.expected.common.blockHash,
    });

    const offered = negotiation(forkSession).proposed.params?.points;

    expect(offered?.[0]).not.toEqual(intersection);
    expect(offered).toContainEqual(intersection);
    expect(
      fixture.blocks.flatMap((b) => b.transactions).map((cbor) => readAcceptedTransaction(cbor).id),
    ).not.toContain(fixture.expected.orphan);
    expect(fixture.refusals.map((r) => r.status.phase)).toEqual(["failed", "failed"]);
    expect(fixture.refusals.map((r) => r.status.history.blocks)).toEqual([0, 0]);
  },
);
