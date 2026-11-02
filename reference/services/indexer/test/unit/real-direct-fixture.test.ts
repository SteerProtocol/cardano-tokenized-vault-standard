/** Replay accepted CTVS-1 direct bytes offline; node/CLI provenance belongs to the retained live run. */
import assert from "node:assert/strict";
import type { Schema } from "@cardano-ogmios/client";
import {
  type NetworkBinding,
  type ReviewedBuild,
  readAcceptedTransaction,
  VaultReader,
} from "@ctvs/integration";
import type { Address } from "@ctvs/protocol";
import { NAMES } from "@ctvs/protocol";
import { expect, it } from "vitest";
import { ledgerAddress } from "../../../../testing/ledger/serialization.js";
import { acceptedBlock } from "../../src/chain/ogmios.js";
import fixture from "../fixtures/accepted/ctvs1-ada-direct.json" with { type: "json" };
import mint from "../fixtures/accepted/ogmios-ctvs1-mint.json" with { type: "json" };
import redeem from "../fixtures/accepted/ogmios-ctvs1-redeem.json" with { type: "json" };
import withdraw from "../fixtures/accepted/ogmios-ctvs1-withdraw.json" with { type: "json" };

const point = (raw: { slot: string; blockHash: string }) => ({ ...raw, slot: BigInt(raw.slot) });

const blocks = fixture.blocks.map((block) => ({
  ...block,
  point: point(block.point),
  parent: point(block.parent),
}));
const policy = fixture.expected.policy;

function reader(end: number) {
  const projection = new VaultReader(
    fixture.network as NetworkBinding,
    fixture.reviewedBuilds as ReviewedBuild[],
    point(fixture.intersection),
  );

  for (const block of blocks.slice(0, end + 1)) projection.rollForward(block);

  return projection;
}

it.each(fixture.expected.steps)(
  "replays accepted $operation with exact fees, custody and free ownership",
  (step) => {
    const index = blocks.findIndex((block) =>
      block.transactions.some((cbor) => readAcceptedTransaction(cbor).id === step.txId),
    );
    const block = blocks[index];

    assert.ok(block);

    const raw =
      step.operation === "mint" ? mint : step.operation === "withdraw" ? withdraw : redeem;

    expect(acceptedBlock(raw.block as unknown as Schema.Block, block.parent)).toEqual(block);

    const before = reader(index - 1);
    const after = reader(index);
    const source = { ...step.sourceRef, index: BigInt(step.sourceRef.index) };
    const amount = BigInt(step.amount);
    const view =
      step.operation === "mint"
        ? before.previewMint(policy, { shares: amount })
        : step.operation === "withdraw"
          ? before.previewWithdraw(policy, { assets: amount })
          : before.previewRedeem(policy, { shares: amount });

    expect(before.context(policy).stateInput.ref).toEqual(source);
    expect(view.data.result).toEqual({ status: "known", value: BigInt(step.bound) });
    expect(view.data.quote).toMatchObject({
      operation: step.operation,
      amount,
      grossAssets: BigInt(step.gross),
      netAssets: BigInt(step.net),
      shares: BigInt(step.shares),
      fee: BigInt(step.fee),
    });
    expect(view.data.pricing).toBe("exact_at_snapshot");
    expect(view.data.capabilities.execution).toBe("direct");
    expect(after.snapshot(policy).data.state).toMatchObject({
      backingAssets: BigInt(step.backing),
      economicSupply: BigInt(step.supply),
      accruedFees: BigInt(step.fees),
      storageLovelace: 10000000n,
      sequence: BigInt(step.sequence),
    });
    expect(after.snapshot(policy).evidence.genesis).toBe(fixture.expected.genesisTxId);
    expect(after.context(policy).stateInput.ref).toEqual({ txId: step.txId, index: 0n });
    expect(after.context(policy).stateInput.value).toEqual({
      ada: BigInt(step.backing) + BigInt(step.fees) + 10000000n,
      [`${policy}.${NAMES.state}`]: 1n,
    });
    expect(after.ownership(policy, fixture.expected.owner as Address).data.freeShares).toBe(
      BigInt(step.supply),
    );

    const cbor = block.transactions.find(
      (bytes) => readAcceptedTransaction(bytes).id === step.txId,
    );

    assert.ok(cbor);

    const accepted = readAcceptedTransaction(cbor);

    expect(accepted.valid).toBe(true);
    expect(accepted.inputs).toContainEqual(source);
    expect(accepted.outputs[1]?.value).toEqual(
      Object.fromEntries(
        Object.entries(step.receiverValue).map(([unit, quantity]) => [unit, BigInt(quantity)]),
      ),
    );
    expect(accepted.outputs[1]?.address).toEqual(ledgerAddress(fixture.expected.owner as Address));
  },
);
