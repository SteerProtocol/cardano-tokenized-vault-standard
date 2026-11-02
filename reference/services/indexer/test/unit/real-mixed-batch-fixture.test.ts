/** Original accepted mixed-batch bytes preserve both gross obligations even without a mint policy witness. */
import assert from "node:assert/strict";
import type { Schema } from "@cardano-ogmios/client";
import { dispatchRead, readAcceptedTransaction } from "@ctvs/integration";
import { ECONOMIC_METHODS, QUERY_VERSION } from "@ctvs/integration/query";
import {
  type Address,
  decodeData,
  enterprise,
  NAMES,
  redeemerFromData,
  refId,
} from "@ctvs/protocol";
import { expect, it } from "vitest";
import { ledgerAddress } from "../../../../testing/ledger/serialization.js";
import { acceptedBlock } from "../../src/chain/ogmios.js";
import ada from "../fixtures/accepted/ctvs2-ada-mixed-batches.json" with { type: "json" };
import native from "../fixtures/accepted/ctvs2-native-mixed-batches.json" with { type: "json" };
import { batchEvidence } from "../support/evidence/batch.js";
import { projection, state } from "./native-rollback-fixture.js";

const fixtures = [ada, native];

type Fixture = (typeof fixtures)[number];
type Batch = Fixture["batches"][number];

const point = (raw: { slot: string; blockHash: string }) => ({ ...raw, slot: BigInt(raw.slot) });

const ref = (raw: { txId: string; index: string }) => ({ ...raw, index: BigInt(raw.index) });

const blocks = (fixture: Fixture) =>
  fixture.blocks.map((block) => ({
    ...block,
    point: point(block.point),
    parent: point(block.parent),
  }));

function at(fixture: Fixture, txId: string) {
  const history = blocks(fixture);
  const index = history.findIndex((block) =>
    block.transactions.some((cbor) => readAcceptedTransaction(cbor).id === txId),
  );
  const block = history[index];
  const reader = projection(fixture);

  assert.ok(block);

  for (const previous of history.slice(0, index)) reader.rollForward(previous);

  const cbor = block.transactions.find(
    (candidate) => readAcceptedTransaction(candidate).id === txId,
  );

  assert.ok(cbor);

  return { reader, block, cbor, history, index };
}

function value(fixture: Fixture, amount: bigint, lovelace: bigint) {
  const asset = fixture.expected.underlying;

  return typeof asset === "string"
    ? { ada: amount + lovelace }
    : { ada: lovelace, [`${asset.policy}.${asset.name}`]: amount };
}

function ownership(fixture: Fixture, reader: ReturnType<typeof projection>) {
  return reader.ownership(fixture.expected.policy, fixture.expected.owner as Address).data;
}

function read(fixture: Fixture, row: Batch, reader: ReturnType<typeof projection>) {
  return dispatchRead(
    reader,
    fixture.expected.policy,
    {
      apiVersion: QUERY_VERSION,
      queries: {
        snapshot: true,
        context: true,
        ownership: { address: fixture.expected.owner as Address },
        convertToAssets: { shares: 10000000n },
        convertToShares: { assets: 10000000n },
        previewDeposit: { assets: BigInt(row.step.deposit) },
        previewMint: { shares: 100000000n },
        previewWithdraw: { assets: 9900000n },
        previewRedeem: { shares: BigInt(row.step.redeem) },
      },
    },
    { instance: "recorded-mixed-batch", recoveryGeneration: 0 },
  );
}

function economics(fixture: Fixture, row: Batch, reader: ReturnType<typeof projection>) {
  const actual = read(fixture, row, reader);
  const expected = {
    convertToAssets: 10000000n,
    convertToShares: 10000000n,
    previewDeposit: BigInt(row.step.issued),
    previewMint: 101000000n,
    previewWithdraw: 9999000n,
    previewRedeem: BigInt(row.step.redeemed),
  };
  const s = actual.data.snapshot.state;

  for (const method of ECONOMIC_METHODS) {
    expect(actual.data[method].result).toEqual({ status: "known", value: expected[method] });
    expect(actual.data[method].units.assets).toEqual(fixture.expected.underlying);
    expect(actual.data[method].feeUnits.protocol).toEqual(fixture.expected.underlying);
    expect(actual.data[method].feeUnits.storage).toBe("lovelace");
  }

  expect(actual.data.context.stateInput.value).toEqual({
    ...value(fixture, s.backingAssets + s.accruedFees, 10000000n),
    [`${fixture.expected.policy}.${NAMES.state}`]: 1n,
  });
  expect(actual.data.context.deployment.configRef).toEqual(ref(fixture.expected.configRef));
}

function funded(fixture: Fixture, row: Batch, reader: ReturnType<typeof projection>) {
  const policy = fixture.expected.policy;

  for (const [index, raw] of row.claims.entries()) {
    const claim = reader.claimView(policy, ref(raw)).data;
    const request = row.requests[index];

    assert.ok(request);
    expect(reader.request(policy, ref(request)).data.status).toBe("claimable");
    expect(claim.unspent).toBe(true);
    expect(claim.claim.stateRef).toEqual(ref(row.pricingBasis));
    expect(claim.claim.requestRef).toEqual(ref(request));
    expect(claim.claim.receiver.address).toEqual(fixture.expected.owner);
    expect(claim.claim.economicQuantity).toBe(
      BigInt(index === 0 ? row.step.issued : row.step.redeemed),
    );
    expect(claim.claim.carriedLovelace).toBe(index === 0 ? 7900000n : 8900000n);
    expect(claim.source.value).toEqual(
      index === 0
        ? { ada: 7900000n, [`${policy}.${NAMES.share}`]: BigInt(row.step.issued) }
        : value(fixture, BigInt(row.step.redeemed), 8900000n),
    );
  }

  expect(ownership(fixture, reader)).toMatchObject({
    freeShares: BigInt(row.beforeState.economicSupply) - BigInt(row.step.redeem),
    issuedUndeliveredShares: BigInt(row.step.issued),
    fixedAssetClaims: BigInt(row.step.redeemed),
    lockedRedemptionShares: 0n,
    pendingDepositAssets: 0n,
  });
}

const cases = fixtures.flatMap((fixture) =>
  fixture.batches.map((row) => ({
    fixture,
    row,
    label: `${fixture.expected.underlying === "ada" ? "ada" : "native"} ${row.step.stage}`,
  })),
);

it.each(cases)(
  "settles accepted $label with both gross obligations and exact net mint",
  ({ fixture, row }) => {
    const { reader, block, cbor } = at(fixture, row.settle);
    const policy = fixture.expected.policy;

    state(reader, policy, row.beforeState);
    expect(ownership(fixture, reader)).toMatchObject({
      lockedRedemptionShares: BigInt(row.step.redeem),
      pendingDepositAssets: BigInt(row.step.deposit),
    });
    reader.rollForward(block);
    state(reader, policy, row.settledState);
    funded(fixture, row, reader);
    economics(fixture, row, reader);

    const evidence = batchEvidence(cbor, policy);
    const delta = BigInt(row.step.delta);

    expect(evidence).toEqual({
      hasMint: delta !== 0n,
      shares: delta === 0n ? null : delta,
      requiredSigners: [fixture.expected.actor],
      signerHashes: [fixture.expected.actor],
    });

    const tx = readAcceptedTransaction(cbor);
    const raw = tx.spends.get(refId(ref(row.pricingBasis)));

    assert.ok(raw);

    const action = redeemerFromData("state", decodeData(raw));

    assert.equal(action.operation, "batch");

    if (action.operation !== "batch") throw new Error("missing batch action");

    expect(action.entries).toHaveLength(2);
    expect(action.entries.map((entry) => refId(entry.requestRef))).toEqual(
      row.requests.map((request) => refId(ref(request))).sort(),
    );
    expect(action.rewardOutput).toBe(3n);
    expect(tx.spends.size).toBe(3);
    expect(tx.outputs[3]?.value).toEqual({ ada: 2200000n });
    expect(tx.outputs[3]?.address).toBe(ledgerAddress(enterprise(fixture.expected.actor, "key")));

    for (const request of row.requests) {
      const ack = tx.spends.get(refId(ref(request)));

      assert.ok(ack);
      expect(redeemerFromData("request", decodeData(ack))).toEqual({
        role: "request",
        operation: "acknowledge",
        stateRef: ref(row.pricingBasis),
      });
    }
  },
);

it.each(cases)(
  "delivers both accepted $label Claims without spending State or repricing",
  ({ fixture, row }) => {
    const { reader, block, cbor } = at(fixture, row.deliver);
    const before = reader.context(fixture.expected.policy).stateInput;

    funded(fixture, row, reader);

    const tx = readAcceptedTransaction(cbor);

    expect(tx.inputs).not.toContainEqual(before.ref);
    expect(tx.referenceInputs).not.toContainEqual(ref(fixture.expected.configRef));
    expect(batchEvidence(cbor, fixture.expected.policy)).toEqual({
      hasMint: false,
      shares: null,
      requiredSigners: [],
      signerHashes: [fixture.expected.actor],
    });

    for (const [index, raw] of row.claims.entries()) {
      const output = Number(raw.index) - 1;
      const expected = row.claimValues[index];

      assert.ok(expected);
      expect(tx.outputs[output]?.value).toEqual(
        Object.fromEntries(Object.entries(expected).map(([key, amount]) => [key, BigInt(amount)])),
      );
      expect(tx.outputs[output]?.address).toBe(ledgerAddress(fixture.expected.owner as Address));
      expect(tx.outputs[output]?.datum ?? null).toBeNull();
    }

    reader.rollForward(block);
    state(reader, fixture.expected.policy, row.deliveredState);
    expect(reader.context(fixture.expected.policy).stateInput).toEqual(before);
    expect(ownership(fixture, reader)).toMatchObject({
      freeShares: BigInt(row.step.backing),
      issuedUndeliveredShares: 0n,
      fixedAssetClaims: 0n,
    });

    for (const request of row.requests)
      expect(reader.request(fixture.expected.policy, ref(request)).data.status).toBe("delivered");
  },
);

it.each(cases)(
  "reverses accepted $label escrow and Claim accounting in offline replay",
  ({ fixture, row }) => {
    const { reader, block, history, index } = at(fixture, row.settle);

    for (const current of history.slice(index)) reader.rollForward(current);

    const final = reader.snapshot(fixture.expected.policy);

    reader.rollBackward(block.point);
    funded(fixture, row, reader);
    reader.rollBackward(block.parent);
    state(reader, fixture.expected.policy, row.beforeState);
    expect(ownership(fixture, reader)).toMatchObject({
      lockedRedemptionShares: BigInt(row.step.redeem),
      pendingDepositAssets: BigInt(row.step.deposit),
      issuedUndeliveredShares: 0n,
      fixedAssetClaims: 0n,
    });

    for (const request of row.requests)
      expect(reader.request(fixture.expected.policy, ref(request)).data.status).toBe(
        "pending_escrow",
      );

    for (const claim of row.claims)
      expect(() => reader.claim(fixture.expected.policy, ref(claim))).toThrow();

    for (const current of history.slice(index)) reader.rollForward(current);

    expect(reader.snapshot(fixture.expected.policy)).toEqual(final);
  },
);

it.each(fixtures)(
  "matches original $expected.underlying mixed and zero-net Ogmios blocks to committed bytes",
  (fixture) => {
    for (const row of fixture.batches) {
      const { block } = at(fixture, row.settle);
      const stage = row.step.stage as keyof typeof fixture.wire;

      expect(
        acceptedBlock(fixture.wire[stage].block as unknown as Schema.Block, block.parent),
      ).toEqual(block);
    }
  },
);

it.each(fixtures)(
  "reconciles all accepted $expected.underlying mixed batches and final delivered supply",
  (fixture) => {
    const reader = projection(fixture);

    for (const block of blocks(fixture)) reader.rollForward(block);

    state(reader, fixture.expected.policy, fixture.expected.finalState);
    expect(reader.context(fixture.expected.policy).stateInput.ref).toEqual(
      ref(fixture.expected.finalStateRef),
    );
    expect(ownership(fixture, reader)).toMatchObject({
      freeShares: 97222225n,
      issuedUndeliveredShares: 0n,
      fixedAssetClaims: 0n,
      lockedRedemptionShares: 0n,
      pendingDepositAssets: 0n,
    });

    const zero = fixture.batches.find((row) => row.step.stage === "zero-net");

    assert.ok(zero);
    expect(zero.beforeState.backingAssets).toBe(zero.settledState.backingAssets);
    expect(zero.beforeState.economicSupply).toBe(zero.settledState.economicSupply);
    expect(BigInt(zero.settledState.accruedFees) - BigInt(zero.beforeState.accruedFees)).toBe(
      199011n,
    );
    economics(fixture, zero, reader);

    for (const row of fixture.batches)
      for (const request of row.requests)
        expect(reader.request(fixture.expected.policy, ref(request)).data.status).toBe("delivered");
  },
);
