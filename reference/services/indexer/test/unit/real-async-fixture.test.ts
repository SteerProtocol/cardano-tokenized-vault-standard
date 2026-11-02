/** Real CTVS-2 acceptance bytes replay offline; the branch reversal here is synthetic. */
import type { Schema } from "@cardano-ogmios/client";

import { buildRefundPlanFromCbor } from "@ctvs/ctvs2";
import {
  type NetworkBinding,
  type ReviewedBuild,
  readAcceptedTransaction,
  VaultReader,
} from "@ctvs/integration";
import { expect, it } from "vitest";
import { acceptedBlock } from "../../src/chain/ogmios.js";
import fixture from "../fixtures/accepted/ctvs2-ada-lifecycle.json" with { type: "json" };
import settlement from "../fixtures/accepted/ogmios-ctvs2-settlement.json" with { type: "json" };

const point = (raw: { slot: string; blockHash: string }) => ({
  slot: BigInt(raw.slot),
  blockHash: raw.blockHash,
});

const blocks = fixture.blocks.map((block) => ({
  ...block,
  point: point(block.point),
  parent: point(block.parent),
}));
const policy = fixture.expected.policy;

const ref = (stage: keyof typeof fixture.expected.stages, index = 0n) => ({
  txId: fixture.expected.stages[stage],
  index,
});

const indexOf = (stage: keyof typeof fixture.expected.stages) => {
  const index = blocks.findIndex((block) =>
    block.transactions.some(
      (cbor) => readAcceptedTransaction(cbor).id === fixture.expected.stages[stage],
    ),
  );

  if (index < 0) throw new Error(`Missing accepted ${stage}`);

  return index;
};

const reader = (end = blocks.length - 1) => {
  const projection = new VaultReader(
    fixture.network as NetworkBinding,
    fixture.reviewedBuilds as ReviewedBuild[],
    point(fixture.intersection),
  );

  for (const block of blocks.slice(0, end + 1)) projection.rollForward(block);

  return projection;
};

it("replays accepted request, settlement and delivery lineage without counting escrow as backing", () => {
  const committed = blocks[indexOf("settle-deposit")];

  if (!committed) throw new Error("missing committed settlement");

  expect(acceptedBlock(settlement.block as unknown as Schema.Block, committed.parent)).toEqual(
    committed,
  );

  const pending = reader(indexOf("request-deposit"));

  expect(pending.snapshot(policy).data.state.backingAssets).toBe(0n);
  expect(pending.request(policy, ref("request-deposit")).data.status).toBe("pending_escrow");

  const settled = reader(indexOf("settle-deposit"));
  const claim = settled.claim(policy, ref("settle-deposit", 1n)).data;

  expect(claim.claim.requestRef).toEqual(ref("request-deposit"));
  expect(claim.claim.stateRef).toEqual(ref("genesis", 1n));
  expect(claim.claim.economicQuantity).toBe(100000000n);
  expect(claim.claim.carriedLovelace).toBe(7900000n);
  expect(settled.request(policy, ref("request-deposit")).data.status).toBe("claimable");
  expect(settled.ownership(policy, claim.claim.receiver.address).data.freeShares).toBe(0n);

  const delivered = reader(indexOf("deliver-deposit"));

  expect(delivered.context(policy).stateInput).toEqual(settled.context(policy).stateInput);
  expect(delivered.request(policy, ref("request-deposit")).data.status).toBe("delivered");
  expect(delivered.ownership(policy, claim.claim.receiver.address).data.freeShares).toBe(
    100000000n,
  );
});

it("reconciles actual redemption, fee custody and final delivered ownership", () => {
  const projection = reader();
  const state = projection.snapshot(policy).data.state;

  expect(state.backingAssets).toBe(90000000n);
  expect(state.economicSupply).toBe(90000000n);
  expect(state.accruedFees).toBe(1099010n);
  expect(projection.context(policy).stateInput.value.ada).toBe(101099010n);

  const claim = projection.claim(policy, ref("settle-redeem", 1n)).data;

  expect(claim.claim.economicQuantity).toBe(9900990n);
  expect(claim.delivered).toBe(true);
  expect(projection.request(policy, ref("request-redeem")).data.status).toBe("delivered");
  expect(projection.ownership(policy, claim.claim.receiver.address).data.freeShares).toBe(
    90000000n,
  );
});

it("preserves opaque recovery bytes and complete refund custody in accepted cancel and expiry", () => {
  const before = reader(indexOf("recovery-candidates"));
  const after = reader();

  for (const [index, stage] of [
    [0n, "cancel"],
    [1n, "expiry"],
  ] as const) {
    const sourceRef = ref("recovery-candidates", index);
    const view = before.request(policy, sourceRef).data;

    expect(view.request).toBeNull();
    expect(view.requestValidation.status).toBe("unsupported");

    const raw = before.recoverySource(policy, sourceRef);

    if (raw.deployment.family !== "ctvs2") throw new Error("wrong family");

    expect(raw.source.datumCbor).toBe(view.source.datum);

    const plan = buildRefundPlanFromCbor({
      ...raw,
      deployment: raw.deployment,
      mode: stage,
      validity: {
        lowerPosixMs: view.recovery.deadlinePosixMs,
        upperPosixMs: view.recovery.deadlinePosixMs + 60000n,
      },
    });
    const accepted = blocks
      .flatMap((block) => block.transactions)
      .map(readAcceptedTransaction)
      .find((tx) => tx.id === fixture.expected.stages[stage]);

    expect(accepted?.outputs[0]?.value).toEqual(plan.outputs[0]?.value);
    expect(after.request(policy, sourceRef).data.status).toBe("refunded");
    expect(() => after.recoverySource(policy, sourceRef)).toThrow("no unspent");
  }

  expect(after.context(policy).stateInput).toEqual(before.context(policy).stateInput);
});

it("restores accepted Claim and Request states in offline rollback and reproduces replay", () => {
  const projection = reader();
  const before = projection.snapshot(policy);
  const settlement = indexOf("settle-redeem");
  const block = blocks[settlement];

  if (!block) throw new Error("missing settlement");

  projection.rollBackward(block.point);
  expect(projection.claim(policy, ref("settle-redeem", 1n)).data.delivered).toBe(false);
  expect(projection.request(policy, ref("request-redeem")).data.status).toBe("claimable");
  projection.rollBackward(block.parent);
  expect(projection.request(policy, ref("request-redeem")).data.status).toBe("pending_escrow");
  expect(() => projection.claim(policy, ref("settle-redeem", 1n))).toThrow();

  for (const next of blocks.slice(settlement)) projection.rollForward(next);

  expect(projection.snapshot(policy)).toEqual(before);
});
