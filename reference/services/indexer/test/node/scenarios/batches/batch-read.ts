/** Coherent per-Request reads fit the public field budget; the harness pins both to one frozen basis. */
import type { QueryResponse } from "@ctvs/integration/query";
import { ECONOMIC_METHODS } from "@ctvs/integration/query";
import { assetId, type OutRef } from "@ctvs/protocol";
import { expect } from "vitest";
import { economicUnits } from "../../support/assets.js";
import { write } from "../../support/environment.js";
import { type Flow, synced } from "../../support/flow.js";
import { freeze, primary } from "../../support/fork.js";
import { economicRead, statelessRead } from "../../support/persistence.js";
import type { BatchVector } from "./batch-vectors.js";

export function batchQueries(f: Flow, step: BatchVector, request: OutRef, claim?: OutRef) {
  return {
    ...economicRead(f),
    previewDeposit: { assets: step.deposit, include: ["construction"] as const },
    previewRedeem: { shares: step.redeem, include: ["construction"] as const },
    request: { ref: request },
    ...(claim ? { claim: { ref: claim } } : {}),
  };
}

export type BatchView = QueryResponse<ReturnType<typeof batchQueries>>;
export type BatchPair = [BatchView, BatchView];

export async function batchPoint(
  f: Flow,
  step: BatchVector,
  refs: [OutRef, OutRef],
  label: string,
  claims?: [OutRef, OutRef],
): Promise<BatchPair> {
  const selected = await freeze(primary(f.env));

  await synced(
    () => f.vault.snapshot(),
    (response) => response.chainPoint.blockHash === selected.hash,
    label,
  );

  const deposit = await statelessRead(
    f,
    batchQueries(f, step, refs[0], claims?.[0]),
    `${label}-deposit`,
  );
  const redeem = await statelessRead(
    f,
    batchQueries(f, step, refs[1], claims?.[1]),
    `${label}-redeem`,
  );

  expect(redeem.basis).toEqual(deposit.basis);
  expect(redeem.data.context).toEqual(deposit.data.context);
  expect(redeem.data.ownership).toEqual(deposit.data.ownership);

  return [deposit, redeem];
}

export function batchViews(f: Flow, step: BatchVector, pair: BatchPair) {
  const expected = {
    convertToAssets: 10000000n,
    convertToShares: 10000000n,
    previewDeposit: step.issued,
    previewMint: 101000000n,
    previewWithdraw: 9999000n,
    previewRedeem: step.redeemed,
  };

  for (const response of pair) {
    for (const method of ECONOMIC_METHODS) {
      const view = response.data[method];

      economicUnits(f, view);
      expect(view.result).toEqual({ status: "known", value: expected[method] });
    }

    expect(response.data.previewDeposit.pricing).toBe("indicative_until_settlement");
    expect(response.data.previewRedeem.pricing).toBe("indicative_until_settlement");
    expect(response.data.previewDeposit.fees.protocol).toEqual({
      status: "known",
      value: step.entryFee,
    });
    expect(response.data.previewRedeem.fees.protocol).toEqual({
      status: "known",
      value: step.exitFee,
    });
    expect(response.data.previewDeposit.construction).toEqual(response.data.context);
    expect(response.data.previewRedeem.construction).toEqual(response.data.context);
    expect(response.data.previewMint.availability.code).toBe("ASYNC_EXECUTION_UNSUPPORTED");
    expect(response.data.previewWithdraw.availability.code).toBe("ASYNC_EXECUTION_UNSUPPORTED");
  }
}

/** Funded native Claims remain outside backing but still belong in the exact whole-wallet inventory. */
export async function batchInventory(f: Flow, pair: BatchPair, label: string) {
  if (f.installed.terms.underlying === "ada") return;

  f.w.selectOwner();

  const asset = assetId(f.installed.terms.underlying);
  const unit = asset.replace(".", "");
  const outputs = await f.w.lucid.wallet().getUtxos();
  const wallet = outputs.reduce((total, output) => total + (output.assets[unit] ?? 0n), 0n);
  const state = pair[0].data.context.stateInput.value[asset] ?? 0n;
  const claims = pair.reduce(
    (total, view) => total + (view.data.claim.source.value[asset] ?? 0n),
    0n,
  );
  const unrelated = outputs.reduce(
    (total, output) => total + (output.assets[f.installed.unit] ?? 0n),
    0n,
  );

  expect(wallet + state + claims).toBe(9007199254740993n);
  expect(unrelated).toBe(9007199254740993n);
  write(f.env.directory, `${label}-inventory`, {
    initial: 9007199254740993n,
    wallet,
    state,
    claims,
    unrelated,
  });
}
