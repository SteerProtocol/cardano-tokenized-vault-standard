/** Replay retained G0 node bytes offline. Synthetic fork manipulation below is not an actual node rollback. */

import type { Schema } from "@cardano-ogmios/client";
import type { NetworkBinding, ReviewedBuild } from "@ctvs/integration";
import { readAcceptedTransaction, VaultReader } from "@ctvs/integration";
import { expect, it } from "vitest";
import { acceptedBlock } from "../../src/chain/ogmios.js";
import fixture from "../fixtures/accepted/ctvs1-ada-g0.json" with { type: "json" };
import depositResponse from "../fixtures/accepted/ogmios-deposit.json" with { type: "json" };
import genesisResponse from "../fixtures/accepted/ogmios-genesis.json" with { type: "json" };

const point = (raw: { slot: string; blockHash: string }) => ({
  slot: BigInt(raw.slot),
  blockHash: raw.blockHash,
});

const blocks = fixture.blocks.map((block) => ({
  ...block,
  point: point(block.point),
  parent: point(block.parent),
}));

const reader = () =>
  new VaultReader(
    fixture.network as NetworkBinding,
    fixture.reviewedBuilds as ReviewedBuild[],
    point(fixture.intersection),
  );

it("authenticates the retained real genesis and deposit with exact accepted State custody", () => {
  for (const response of [genesisResponse, depositResponse]) {
    const committed = blocks.find((block) => block.point.blockHash === response.block.id);

    if (!committed) throw new Error("missing committed block");

    expect(acceptedBlock(response.block as unknown as Schema.Block, committed.parent)).toEqual(
      committed,
    );
  }

  const projection = reader();

  for (const block of blocks) projection.rollForward(block);

  const snapshot = projection.snapshot(fixture.expected.policy);

  expect(snapshot.data.backingAssets).toEqual({
    status: "known",
    value: BigInt(fixture.expected.backingAssets),
  });
  expect(snapshot.data.economicSupply).toEqual({
    status: "known",
    value: BigInt(fixture.expected.economicSupply),
  });
  expect(snapshot.data.excludedFees).toEqual({
    status: "known",
    value: BigInt(fixture.expected.accruedFees),
  });
  expect(snapshot.evidence.genesis).toBe(fixture.expected.genesisTxId);
  expect(snapshot.evidence.state).toEqual({
    txId: fixture.expected.stateRef.txId,
    index: BigInt(fixture.expected.stateRef.index),
  });
  expect(projection.context(fixture.expected.policy).stateInput.value.ada).toBe(111000000n);
});

it("reverses and replays the retained deposit without changing authenticated genesis", () => {
  const projection = reader();

  for (const block of blocks) projection.rollForward(block);

  const before = projection.snapshot(fixture.expected.policy);
  const index = blocks.findIndex((block) =>
    block.transactions.some(
      (cbor) => readAcceptedTransaction(cbor).id === fixture.expected.genesisTxId,
    ),
  );
  const target = blocks[index]?.point;

  if (!target) throw new Error("missing real genesis block");

  projection.rollBackward(target);
  expect(projection.snapshot(fixture.expected.policy).data.backingAssets).toEqual({
    status: "known",
    value: 0n,
  });

  for (const block of blocks.slice(index + 1)) projection.rollForward(block);

  expect(projection.snapshot(fixture.expected.policy)).toEqual(before);
});
