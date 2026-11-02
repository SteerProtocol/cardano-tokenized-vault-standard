/** Maintenance consumes HTTP context and checks independent State, custody, authorization and view invariants. */
import assert from "node:assert/strict";
import * as ctvs1 from "@ctvs/ctvs1";
import * as ctvs2 from "@ctvs/ctvs2";
import { readAcceptedTransaction, toPlannerContext } from "@ctvs/integration";
import type { QueryResponse } from "@ctvs/integration/query";
import { ECONOMIC_METHODS } from "@ctvs/integration/query";
import type { OutRef } from "@ctvs/protocol";
import { stateFromData } from "@ctvs/protocol";
import { expect } from "vitest";
import { ledgerAddress } from "../../../../../../testing/ledger/serialization.js";
import { maintenanceEvidence } from "../../../support/evidence/authorization.js";
import { economicUnits, stateCustody, underlyingValue } from "../../support/assets.js";
import { write } from "../../support/environment.js";
import { execute, type Flow, readback, synced } from "../../support/flow.js";
import { type ForkNode, forge, freeze, primary } from "../../support/fork.js";
import { economicRead, statelessRead } from "../../support/persistence.js";

export const maintenanceSteps = [
  { stage: "pause-entry", operation: "set_pause", flags: 1n, fees: 1000000n, reserve: 10000000n },
  { stage: "pause-exit", operation: "set_pause", flags: 2n, fees: 1000000n, reserve: 10000000n },
  { stage: "pause-both", operation: "set_pause", flags: 3n, fees: 1000000n, reserve: 10000000n },
  { stage: "collect-fees", operation: "collect_fees", flags: 3n, fees: 0n, reserve: 10000000n },
  { stage: "top-up-reserve", operation: "top_up_reserve", flags: 3n, fees: 0n, reserve: 11000000n },
  { stage: "unpause", operation: "set_pause", flags: 0n, fees: 0n, reserve: 11000000n },
] as const;

export interface MaintenanceStep {
  stage: string;
  operation: "set_pause" | "collect_fees" | "top_up_reserve";
  flags: bigint;
  fees: bigint;
  reserve: bigint;
}

export function maintenanceRead(f: Flow, history?: { request: OutRef; claim: OutRef }) {
  return {
    ...economicRead(f),
    ...(history ? { request: { ref: history.request }, claim: { ref: history.claim } } : {}),
  };
}

export type MaintenanceRead = QueryResponse<ReturnType<typeof maintenanceRead>>;

function plan(before: MaintenanceRead, step: MaintenanceStep) {
  const raw = before.data.context;

  if (raw.deployment.family === "ctvs1") {
    const context = toPlannerContext(raw, "ctvs1");

    if (step.operation === "collect_fees")
      return ctvs1.buildCollectFeesPlan({ ...context, receiverTopup: 2000000n });

    if (step.operation === "top_up_reserve")
      return ctvs1.buildTopUpReservePlan({ ...context, additionalLovelace: 1000000n });

    return ctvs1.buildSetPausePlan({ ...context, pauseFlags: step.flags });
  }

  const context = toPlannerContext(raw, "ctvs2");

  if (step.operation === "collect_fees")
    return ctvs2.buildCollectFeesPlan({ ...context, receiverTopup: 2000000n });

  if (step.operation === "top_up_reserve")
    return ctvs2.buildTopUpReservePlan({ ...context, additionalLovelace: 1000000n });

  return ctvs2.buildSetPausePlan({ ...context, pauseFlags: step.flags });
}

export function maintenanceViews(f: Flow, response: MaintenanceRead, previous?: MaintenanceRead) {
  const flags = response.data.snapshot.state.pauseFlags;

  for (const method of ECONOMIC_METHODS) {
    const view = response.data[method];

    economicUnits(f, view);

    if (previous) {
      expect(view.result).toEqual(previous.data[method].result);
      expect(view.quote).toEqual(previous.data[method].quote);
    }

    if (method === "convertToAssets" || method === "convertToShares") {
      expect(view.availability).toEqual({ status: "not_applicable", code: "VALUATION_ONLY" });
    } else if (
      f.installed.deployment.family === "ctvs2" &&
      (method === "previewMint" || method === "previewWithdraw")
    ) {
      expect(view.availability).toEqual({
        status: "unsupported",
        code: "ASYNC_EXECUTION_UNSUPPORTED",
      });
    } else {
      const bit = method === "previewDeposit" || method === "previewMint" ? 1n : 2n;

      expect(view.availability).toEqual(
        flags & bit
          ? { status: "unavailable", code: "PAUSED" }
          : { status: "available", code: "AVAILABLE" },
      );
    }
  }
}

export async function maintenancePoint(
  f: Flow,
  requested: ReturnType<typeof maintenanceRead>,
  label: string,
  producer: ForkNode = primary(f.env),
) {
  const selected = await freeze(producer);

  await synced(
    () => f.vault.read(requested),
    (value) => value.basis.chainPoint.blockHash === selected.hash,
    label,
  );

  return statelessRead(f, requested, label);
}

export async function maintenanceStep(
  f: Flow,
  requested: ReturnType<typeof maintenanceRead>,
  before: MaintenanceRead,
  step: MaintenanceStep,
  actor: { hash: string; select: () => void },
  producer: ForkNode = primary(f.env),
) {
  const intent = plan(before, step);
  const pauseKey = f.installed.terms.pauseKey;

  assert.ok(pauseKey);
  expect(actor.hash).not.toBe(pauseKey);
  expect(intent.requiredSigners).toEqual(step.operation === "set_pause" ? [pauseKey] : []);

  if (step.operation === "set_pause") f.w.selectOwner();
  else actor.select();

  forge(producer);

  const receipt = await execute(f, step.stage, intent);
  const after = await maintenancePoint(f, requested, step.stage, producer);
  const expected = {
    ...before.data.snapshot.state,
    sequence: before.data.snapshot.state.sequence + 1n,
    accruedFees: step.fees,
    storageLovelace: step.reserve,
    pauseFlags: step.flags,
  };
  const datum = intent.outputs[0]?.datum;

  assert.ok(datum);
  expect(after.data.snapshot.state).toEqual(expected);
  expect(stateFromData(datum)).toEqual(expected);
  expect(after.data.context.stateInput.value).toEqual(stateCustody(f, expected));
  expect(after.basis.stateRef).toEqual({ txId: receipt.txId, index: 0n });
  expect(after.data.ownership).toEqual(before.data.ownership);
  expect(after.data.snapshot.terms).toEqual(before.data.snapshot.terms);
  expect(after.data.context.deployment.configRef).toEqual(before.data.context.deployment.configRef);
  expect(after.data.request).toEqual(before.data.request);
  expect(after.data.claim).toEqual(before.data.claim);
  maintenanceViews(f, after, before);
  await readback(f, `${step.stage}-state`, after.basis.stateRef, after.data.context.stateInput);
  await expect(f.vault.read(requested, { expectedBasis: before.basis })).rejects.toMatchObject({
    code: "STALE_BASIS",
  });

  const accepted = readAcceptedTransaction(receipt.signedCbor);
  const evidence = maintenanceEvidence(receipt.signedCbor);

  expect(accepted.inputs).toContainEqual(before.basis.stateRef);
  expect(accepted.inputs).not.toContainEqual(before.data.context.deployment.configRef);
  expect(accepted.referenceInputs).toContainEqual(before.data.context.deployment.configRef);
  expect(evidence.hasMint).toBe(false);
  expect(evidence.requiredSigners).toEqual(intent.requiredSigners);
  expect(evidence.signerHashes).toEqual([step.operation === "set_pause" ? pauseKey : actor.hash]);
  expect(
    await f.w.provider.getUtxosByOutRef([
      { txHash: before.basis.stateRef.txId, outputIndex: Number(before.basis.stateRef.index) },
    ]),
  ).toEqual([]);

  if (step.operation === "collect_fees") {
    const payout = accepted.outputs[1];

    expect(payout?.address).toBe(ledgerAddress(f.installed.terms.feeDestination.address));
    expect(payout?.datum ?? null).toBeNull();
    await readback(
      f,
      step.stage === "collect-fees" ? "collected-fees" : `${step.stage}-fees`,
      { txId: receipt.txId, index: 1n },
      { value: underlyingValue(f, 1000000n, 2000000n), datumCbor: null },
    );
  }

  write(f.env.directory, `${step.stage}-maintenance`, {
    step,
    before,
    after,
    evidence,
    txId: receipt.txId,
  });

  return after;
}
