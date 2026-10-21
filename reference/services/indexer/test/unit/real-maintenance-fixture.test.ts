/** Accepted maintenance bytes preserve economic partitions and directional HTTP view semantics. */
import assert from "node:assert/strict";
import type { Schema } from "@cardano-ogmios/client";
import { dispatchRead, readAcceptedTransaction } from "@ctvs/integration";
import { ECONOMIC_METHODS, QUERY_VERSION } from "@ctvs/integration/query";
import { type Address, decodeData, NAMES, redeemerFromData, refId } from "@ctvs/protocol";
import { expect, it } from "vitest";
import { ledgerAddress } from "../../../../testing/ledger/serialization.js";
import { acceptedBlock } from "../../src/chain/ogmios.js";
import ada1 from "../fixtures/accepted/ctvs1-ada-maintenance.json" with { type: "json" };
import native1 from "../fixtures/accepted/ctvs1-native-maintenance.json" with { type: "json" };
import ada2 from "../fixtures/accepted/ctvs2-ada-maintenance.json" with { type: "json" };
import native2 from "../fixtures/accepted/ctvs2-native-maintenance.json" with { type: "json" };
import { maintenanceEvidence } from "../support/evidence/authorization.js";
import { projection, state } from "./native-rollback-fixture.js";

const recordings = [ada1, native1, ada2, native2];

type Recording = (typeof recordings)[number];
type Step = Recording["steps"][number];

const point = (raw: { slot: string; blockHash: string }) => ({ ...raw, slot: BigInt(raw.slot) });

const ref = (raw: { txId: string; index: string }) => ({ ...raw, index: BigInt(raw.index) });

function value(recording: Recording, amount: bigint, lovelace: bigint) {
  const asset = recording.expected.underlying;

  return typeof asset === "string"
    ? { ada: amount + lovelace }
    : { ada: lovelace, [`${asset.policy}.${asset.name}`]: amount };
}

function queries(recording: Recording) {
  return {
    snapshot: true as const,
    context: true as const,
    ownership: { address: recording.expected.owner as Address },
    convertToAssets: { shares: 10000000n },
    convertToShares: { assets: 10000000n },
    previewDeposit: { assets: 101000000n },
    previewMint: { shares: 100000000n },
    previewWithdraw: { assets: 9900000n },
    previewRedeem: { shares: 10000000n },
  };
}

function at(recording: Recording, txId: string) {
  const index = recording.blocks.findIndex((block) =>
    block.transactions.some((cbor) => readAcceptedTransaction(cbor).id === txId),
  );
  const block = recording.blocks[index];
  const reader = projection(recording);

  assert.ok(block);

  for (const previous of recording.blocks.slice(0, index))
    reader.rollForward({
      ...previous,
      point: point(previous.point),
      parent: point(previous.parent),
    });

  const cbor = block.transactions.find((cbor) => readAcceptedTransaction(cbor).id === txId);

  assert.ok(cbor);

  return { reader, block, cbor };
}

function verifyEconomics(recording: Recording, step: Step, reader: ReturnType<typeof projection>) {
  const expected = {
    convertToAssets: 10000000n,
    convertToShares: 10000000n,
    previewDeposit: 100000000n,
    previewMint: 101000000n,
    previewWithdraw: 9999000n,
    previewRedeem: 9900990n,
  };
  const response = dispatchRead(
    reader,
    recording.expected.policy,
    { apiVersion: QUERY_VERSION, queries: queries(recording) },
    { instance: "recorded-maintenance", recoveryGeneration: 0 },
  );

  for (const method of ECONOMIC_METHODS) {
    const view = response.data[method];

    expect(view.result).toEqual({ status: "known", value: expected[method] });
    expect(view.availability).toEqual(step.availability[method]);
    expect(view.units.assets).toEqual(recording.expected.underlying);
    expect(view.feeUnits.protocol).toEqual(recording.expected.underlying);
    expect(view.feeUnits.storage).toBe("lovelace");
  }

  expect(response.data.ownership.freeShares).toBe(100000000n);
  expect(response.data.ownership.pendingDepositAssets).toBe(0n);
  expect(response.data.ownership.issuedUndeliveredShares).toBe(0n);
}

function verifyAccepted(recording: Recording, step: Step, cbor: string) {
  const transaction = readAcceptedTransaction(cbor);
  const raw = transaction.spends.get(refId(ref(step.beforeRef)));

  assert.ok(raw);

  const action = redeemerFromData("state", decodeData(raw));
  const pause = step.operation === "set_pause";
  const evidence = maintenanceEvidence(cbor);

  assert.equal(action.role, "state");

  if (action.role !== "state") throw new Error("expected State maintenance redeemer");

  expect(action.operation).toBe(step.operation);
  expect(action.stateOutput).toBe(0n);

  if (action.operation === "set_pause")
    expect(action.flags).toBe(BigInt(step.afterState.pauseFlags));

  if (action.operation === "top_up_reserve") expect(action.amount).toBe(1000000n);

  expect(evidence.hasMint).toBe(false);
  expect(evidence.requiredSigners).toEqual(pause ? [recording.expected.pauseKey] : []);
  expect(evidence.signerHashes).toEqual([
    pause ? recording.expected.pauseKey : recording.expected.actor,
  ]);
  expect(transaction.inputs).toContainEqual(ref(step.beforeRef));
  expect(transaction.inputs).not.toContainEqual(ref(recording.expected.configRef));
  expect(transaction.referenceInputs).toContainEqual(ref(recording.expected.configRef));

  if (step.operation === "collect_fees") {
    expect(BigInt(step.beforeState.pauseFlags)).toBe(3n);
    expect(transaction.outputs[1]?.value).toEqual(value(recording, 1000000n, 2000000n));
    expect(transaction.outputs[1]?.address).toBe(
      ledgerAddress(recording.expected.owner as Address),
    );
    expect(transaction.outputs[1]?.datum ?? null).toBeNull();
    expect(transaction.outputs[1]?.datumHash).toBeUndefined();
  }
}

it.each(
  recordings.flatMap((recording) =>
    recording.steps.map((step) => ({
      recording,
      step,
      label: `${recording.expected.family} ${recording.expected.underlying === "ada" ? "ada" : "native"} ${step.stage}`,
    })),
  ),
)("replays accepted $label without repricing backing or supply", ({ recording, step }) => {
  const { reader, block, cbor } = at(recording, step.txId);
  const policy = recording.expected.policy;

  state(reader, policy, step.beforeState);
  expect(reader.context(policy).stateInput.ref).toEqual(ref(step.beforeRef));

  const beforeOwnership = reader.ownership(policy, recording.expected.owner as Address).data;
  const request = recording.expected.request;
  const claim = recording.expected.claim;
  const beforeRequest = request ? reader.requestView(policy, ref(request)) : null;
  const beforeClaim = claim ? reader.claimView(policy, ref(claim)) : null;

  reader.rollForward({ ...block, point: point(block.point), parent: point(block.parent) });
  state(reader, policy, step.afterState);
  expect(reader.context(policy).stateInput.ref).toEqual(ref(step.afterRef));
  expect(reader.context(policy).stateInput.value).toEqual({
    ...value(
      recording,
      100000000n + BigInt(step.afterState.accruedFees),
      BigInt(step.afterState.storageLovelace),
    ),
    [`${policy}.${NAMES.state}`]: 1n,
  });
  expect(reader.ownership(policy, recording.expected.owner as Address).data).toEqual(
    beforeOwnership,
  );

  if (request) expect(reader.requestView(policy, ref(request)).data).toEqual(beforeRequest?.data);

  if (claim) expect(reader.claimView(policy, ref(claim)).data).toEqual(beforeClaim?.data);

  verifyEconomics(recording, step, reader);

  verifyAccepted(recording, step, cbor);
});

it.each(recordings)(
  "matches the original $expected.family fee-collection Ogmios block to committed bytes",
  (recording) => {
    const row = recording.steps.find((step) => step.stage === "collect-fees");

    assert.ok(row);

    const { block } = at(recording, row.txId);

    expect(
      acceptedBlock(recording.wire.block as unknown as Schema.Block, point(block.parent)),
    ).toEqual({ ...block, point: point(block.point), parent: point(block.parent) });
  },
);
