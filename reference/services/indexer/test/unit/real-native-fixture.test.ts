/** Accepted native-asset bytes replay offline; live node/CLI provenance is recorded separately. */
import assert from "node:assert/strict";
import type { Schema } from "@cardano-ogmios/client";
import {
  type NetworkBinding,
  type ReviewedBuild,
  readAcceptedTransaction,
  VaultReader,
} from "@ctvs/integration";
import { type Address, NAMES } from "@ctvs/protocol";
import { expect, it } from "vitest";
import { acceptedBlock } from "../../src/chain/ogmios.js";
import direct from "../fixtures/accepted/ctvs1-native-lifecycle.json" with { type: "json" };
import asynchronous from "../fixtures/accepted/ctvs2-native-lifecycle.json" with { type: "json" };
import deposit from "../fixtures/accepted/ogmios-ctvs1-native-deposit.json" with { type: "json" };
import settlement from "../fixtures/accepted/ogmios-ctvs2-native-settlement.json" with {
  type: "json",
};

type Recording = typeof direct | typeof asynchronous;

const point = (raw: { slot: string; blockHash: string }) => ({ ...raw, slot: BigInt(raw.slot) });

const values = (raw: Record<string, string>) =>
  Object.fromEntries(Object.entries(raw).map(([unit, n]) => [unit, BigInt(n)]));

function blockFor(recording: Recording, txId: string) {
  const index = recording.blocks.findIndex((block) =>
    block.transactions.some((cbor) => readAcceptedTransaction(cbor).id === txId),
  );
  const block = recording.blocks[index];

  assert.ok(block);

  return { index, block: { ...block, point: point(block.point), parent: point(block.parent) } };
}

function at(recording: Recording, txId: string, before = false) {
  const { index } = blockFor(recording, txId);
  const reader = new VaultReader(
    recording.network as NetworkBinding,
    recording.reviewedBuilds as ReviewedBuild[],
    point(recording.intersection),
  );

  for (const block of recording.blocks.slice(0, index + (before ? 0 : 1)))
    reader.rollForward({ ...block, point: point(block.point), parent: point(block.parent) });

  return reader;
}

function transaction(recording: Recording, txId: string) {
  const cbor = blockFor(recording, txId).block.transactions.find(
    (bytes) => readAcceptedTransaction(bytes).id === txId,
  );

  assert.ok(cbor);

  return readAcceptedTransaction(cbor);
}

function state(
  reader: VaultReader,
  recording: Recording,
  backing: bigint,
  supply: bigint,
  fees: bigint,
) {
  const { policy, underlyingId, unrelatedId } = recording.expected;

  expect(reader.snapshot(policy).data.state).toMatchObject({
    backingAssets: backing,
    economicSupply: supply,
    accruedFees: fees,
    storageLovelace: 10000000n,
  });
  expect(reader.snapshot(policy).data.underlying).toBe(underlyingId);
  expect(reader.context(policy).terms.underlying).toEqual(recording.expected.underlying);
  expect(reader.context(policy).stateInput.value).toEqual({
    ada: 10000000n,
    [`${policy}.${NAMES.state}`]: 1n,
    ...(backing + fees ? { [underlyingId]: backing + fees } : {}),
  });
  expect(reader.context(policy).stateInput.value[unrelatedId]).toBeUndefined();
}

it.each(direct.expected.steps)(
  "replays CTVS-1 native $operation with separate token economics and ADA reserve",
  (step) => {
    const { policy, underlying } = direct.expected;
    const before = at(direct, step.txId, true);
    const after = at(direct, step.txId);
    const amount = BigInt(step.amount);
    const view =
      step.operation === "deposit"
        ? before.previewDeposit(policy, { assets: amount })
        : step.operation === "mint"
          ? before.previewMint(policy, { shares: amount })
          : step.operation === "withdraw"
            ? before.previewWithdraw(policy, { assets: amount })
            : before.previewRedeem(policy, { shares: amount });

    if (step.operation === "deposit") {
      const committed = blockFor(direct, step.txId).block;

      expect(acceptedBlock(deposit.block as unknown as Schema.Block, committed.parent)).toEqual(
        committed,
      );
    }

    expect(view.data.units.assets).toEqual(underlying);
    expect(view.data.feeUnits.protocol).toEqual(underlying);
    expect(view.data.feeUnits.network).toBe("lovelace");
    expect(view.data.result).toEqual({ status: "known", value: BigInt(step.bound) });
    expect(view.data.quote).toMatchObject({
      grossAssets: BigInt(step.gross),
      netAssets: BigInt(step.net),
      shares: BigInt(step.shares),
      fee: BigInt(step.fee),
    });
    state(after, direct, BigInt(step.backing), BigInt(step.supply), BigInt(step.fees));
    expect(after.ownership(policy, direct.expected.owner as Address).data.freeShares).toBe(
      BigInt(step.supply),
    );
    expect(after.context(policy).stateInput.ref).toEqual({ txId: step.txId, index: 0n });
    expect(transaction(direct, step.txId).inputs).toContainEqual({
      ...step.sourceRef,
      index: BigInt(step.sourceRef.index),
    });
    expect(transaction(direct, step.txId).outputs[1]?.value).toEqual(values(step.receiverValue));
  },
);

it.each(asynchronous.expected.flows)(
  "replays CTVS-2 native $kind escrow, settlement and delivery",
  (flow) => {
    const { policy, underlyingId, owner } = asynchronous.expected;
    const pending = at(asynchronous, flow.requestTxId);
    const fixed = at(asynchronous, flow.settlementTxId);
    const delivered = at(asynchronous, flow.deliveryTxId);
    const ref = { txId: flow.requestTxId, index: 0n };
    const claimRef = { txId: flow.settlementTxId, index: 1n };
    const quantity = flow.kind === "deposit" ? 100000000n : 9900990n;
    const request = pending.requestView(policy, ref).data;
    const claim = fixed.claimView(policy, claimRef).data;

    expect(request.source.value).toEqual(
      flow.kind === "deposit"
        ? { ada: 7000000n, [underlyingId]: 101000000n }
        : { ada: 7000000n, [`${policy}.${NAMES.share}`]: 10000000n },
    );
    state(
      pending,
      asynchronous,
      flow.kind === "deposit" ? 0n : 100000000n,
      flow.kind === "deposit" ? 0n : 100000000n,
      flow.kind === "deposit" ? 0n : 1000000n,
    );
    expect(claim.claim.economicQuantity).toBe(quantity);
    expect(claim.claim.carriedLovelace).toBe(7900000n);
    expect(claim.claim.requestRef).toEqual(ref);
    expect(claim.claim.stateRef).toEqual(pending.context(policy).stateInput.ref);
    expect(claim.source.value).toEqual(
      flow.kind === "deposit"
        ? { ada: 7900000n, [`${policy}.${NAMES.share}`]: quantity }
        : { ada: 7900000n, [underlyingId]: quantity },
    );
    state(
      fixed,
      asynchronous,
      flow.kind === "deposit" ? 100000000n : 90000000n,
      flow.kind === "deposit" ? 100000000n : 90000000n,
      flow.kind === "deposit" ? 1000000n : 1099010n,
    );
    expect(fixed.requestView(policy, ref).data.status).toBe("claimable");
    expect(delivered.requestView(policy, ref).data.status).toBe("delivered");
    expect(delivered.claimView(policy, claimRef).data.unspent).toBe(false);
    expect(delivered.context(policy).stateInput).toEqual(fixed.context(policy).stateInput);
    expect(delivered.ownership(policy, owner as Address).data.freeShares).toBe(
      flow.kind === "deposit" ? 100000000n : 90000000n,
    );
    expect(transaction(asynchronous, flow.deliveryTxId).outputs[0]?.value).toEqual(
      claim.source.value,
    );

    if (flow.kind === "deposit") {
      const committed = blockFor(asynchronous, flow.settlementTxId).block;

      expect(acceptedBlock(settlement.block as unknown as Schema.Block, committed.parent)).toEqual(
        committed,
      );
      expect(fixed.ownership(policy, owner as Address).data.issuedUndeliveredShares).toBe(quantity);
    } else expect(fixed.ownership(policy, owner as Address).data.fixedAssetClaims).toBe(quantity);
  },
);

it.each(asynchronous.expected.recoveries)(
  "replays native full-value $stage recovery without consuming State",
  (recovery) => {
    const { policy } = asynchronous.expected;
    const ref = { ...recovery.request, index: BigInt(recovery.request.index) };
    const before = at(asynchronous, recovery.refundTxId, true);
    const after = at(asynchronous, recovery.refundTxId);
    const request = before.requestView(policy, ref).data;

    expect(request.source.value).toEqual(values(recovery.value));
    expect(request.source.datumCbor).toBe(recovery.datumCbor);

    if (recovery.validation === "unsupported") {
      expect(request.request).toBeNull();
      expect(request.validation.status).toBe("unsupported");
    } else expect(request.validation).toEqual({ status: "known", value: true });

    expect(after.context(policy).stateInput).toEqual(before.context(policy).stateInput);
    state(after, asynchronous, 90000000n, 90000000n, 1099010n);
    expect(after.requestView(policy, ref).data.status).toBe("refunded");
    expect(transaction(asynchronous, recovery.refundTxId).inputs).not.toContainEqual(
      before.context(policy).stateInput.ref,
    );
    expect(transaction(asynchronous, recovery.refundTxId).outputs[0]?.value).toEqual(
      request.source.value,
    );

    if (recovery.mode === "expiry") expect(recovery.signers).not.toContain(recovery.controller);
    else expect(recovery.signers).toContain(recovery.controller);
  },
);
