/** CTVS-1 direct operations use HTTP construction data, explicit caller bounds and real ledger readback. */
import assert from "node:assert/strict";
import { buildDirectPlan } from "@ctvs/ctvs1";
import { readAcceptedTransaction, toPlannerContext } from "@ctvs/integration";
import { createIndexerClient } from "@ctvs/integration/client";
import type { QueryResponse } from "@ctvs/integration/query";
import { NAMES, stateFromData } from "@ctvs/protocol";
import { CML, withCMLScope } from "@lucid-evolution/lucid";
import { expect } from "vitest";
import {
  economicUnits,
  nativeInventory,
  stateCustody,
  underlyingValue,
} from "../../support/assets.js";
import type { capture } from "../../support/capture.js";
import { queryUrl, write } from "../../support/environment.js";
import { execute, type Flow, readback, receipts, synced } from "../../support/flow.js";
import { forge, freeze, primary } from "../../support/fork.js";
import { lookupReady } from "../../support/lookup.js";
import { replay } from "../../support/persistence.js";

// Independent exact vectors for the fixture's one-percent fees and unit price.
const steps = [
  {
    operation: "mint",
    method: "previewMint",
    amount: 13333337n,
    bound: 13466671n,
    gross: 13466671n,
    net: 13333337n,
    shares: 13333337n,
    fee: 133334n,
    backing: 113333337n,
    supply: 113333337n,
    fees: 1133334n,
    sequence: 2n,
  },
  {
    operation: "withdraw",
    method: "previewWithdraw",
    amount: 7777777n,
    bound: 7855555n,
    gross: 7855555n,
    net: 7777777n,
    shares: 7855555n,
    fee: 77778n,
    backing: 105477782n,
    supply: 105477782n,
    fees: 1211112n,
    sequence: 3n,
  },
  {
    operation: "redeem",
    method: "previewRedeem",
    amount: 5555557n,
    bound: 5500551n,
    gross: 5555557n,
    net: 5500551n,
    shares: 5555557n,
    fee: 55006n,
    backing: 99922225n,
    supply: 99922225n,
    fees: 1266118n,
    sequence: 4n,
  },
] as const;

type Step = (typeof steps)[number];

function queries(f: Flow, step: Step) {
  return {
    snapshot: true as const,
    context: true as const,
    ownership: { address: f.installed.receiver.address },
    convertToAssets: { shares: 1234567n },
    convertToShares: { assets: 1234567n },
    previewDeposit: { assets: 10100000n, include: ["construction"] as const },
    previewMint: {
      shares: step.operation === "mint" ? step.amount : 1000000n,
      include: ["construction"] as const,
    },
    previewWithdraw: {
      assets: step.operation === "withdraw" ? step.amount : 990000n,
      include: ["construction"] as const,
    },
    previewRedeem: {
      shares: step.operation === "redeem" ? step.amount : 1000000n,
      include: ["construction"] as const,
    },
  };
}

type DirectResponse = QueryResponse<ReturnType<typeof queries>>;

/** Inspect the final accepted mint field independently of planner quantities and reader ownership. */
export function mintedShares(cbor: string, policy: string): bigint {
  return withCMLScope((own) => {
    const tx = own(CML.Transaction.from_cbor_hex(cbor));
    const body = own(tx.body());
    const mint = own(body.mint());

    assert.ok(mint);

    const policies = own(mint.keys());

    expect(policies.len()).toBe(1);

    const id = own(policies.get(0));
    const assets = own(mint.get_assets(id));

    assert.ok(assets);
    expect(id.to_hex()).toBe(policy);

    const names = own(assets.keys());

    expect(names.len()).toBe(1);

    const name = own(names.get(0));
    const quantity = assets.get(name);

    expect(name.to_hex()).toBe(NAMES.share);
    assert.ok(quantity !== undefined);

    return quantity;
  });
}

async function verifyOutputs(
  f: Flow,
  step: Step,
  before: DirectResponse,
  after: DirectResponse,
  record: Awaited<ReturnType<typeof execute>>,
  plan: ReturnType<typeof buildDirectPlan>,
) {
  const state = after.data.snapshot.state;

  expect(state).toMatchObject({
    backingAssets: step.backing,
    economicSupply: step.supply,
    accruedFees: step.fees,
    storageLovelace: 10000000n,
    pauseFlags: 0n,
    sequence: step.sequence,
  });

  const datum = plan.outputs[0]?.datum;

  assert.ok(datum);
  expect(stateFromData(datum)).toEqual(state);
  expect(after.data.context.stateInput.value).toEqual(stateCustody(f, state));
  expect(after.data.ownership.freeShares).toBe(step.supply);
  expect(after.data.ownership.issuedUndeliveredShares).toBe(0n);
  expect(after.data.context.stateInput.ref).toEqual({ txId: record.txId, index: 0n });
  expect(mintedShares(record.signedCbor, f.installed.deployment.policy)).toBe(
    step.operation === "mint" ? step.shares : -step.shares,
  );
  await readback(
    f,
    `direct-${step.operation}-state`,
    { txId: record.txId, index: 0n },
    after.data.context.stateInput,
  );

  const receiver = plan.outputs[1];

  assert.ok(receiver);

  const output = await readback(
    f,
    `direct-${step.operation}-receiver`,
    { txId: record.txId, index: 1n },
    {
      value: receiver.value,
      datumCbor: null,
    },
  );

  expect(output.address).toBe(await f.w.lucid.wallet().address());
  expect(receiver.value).toEqual(
    step.operation === "mint"
      ? {
          ada: 2000000n,
          [`${f.installed.deployment.policy}.${NAMES.share}`]: step.shares,
        }
      : underlyingValue(f, step.net, 2000000n),
  );
  expect(
    await f.w.provider.getUtxosByOutRef([
      {
        txHash: before.basis.stateRef.txId,
        outputIndex: Number(before.basis.stateRef.index),
      },
    ]),
  ).toEqual([]);
  expect(readAcceptedTransaction(record.signedCbor).inputs).toContainEqual(before.basis.stateRef);
}

async function direct(f: Flow, step: Step) {
  const requested = queries(f, step);
  const before = await synced(
    () => f.vault.read(requested),
    (value) => value.data.snapshot.state.sequence === step.sequence - 1n,
    `before direct ${step.operation}`,
  );
  const economic = before.data[step.method];

  assert.ok(economic.construction);
  expect(economic.pricing).toBe("exact_at_snapshot");
  expect(economic.capabilities.execution).toBe("direct");
  expect(economic.availability.status).toBe("available");
  expect(economic.result).toEqual({ status: "known", value: step.bound });
  expect(economic.quote).toMatchObject({
    operation: step.operation,
    amount: step.amount,
    grossAssets: step.gross,
    netAssets: step.net,
    shares: step.shares,
    fee: step.fee,
  });
  expect(economic.fees.protocol).toEqual({ status: "known", value: step.fee });
  expect(before.data.convertToAssets.result).toEqual({ status: "known", value: 1234567n });
  expect(before.data.convertToShares.result).toEqual({ status: "known", value: 1234567n });

  for (const method of [
    "convertToAssets",
    "convertToShares",
    "previewDeposit",
    "previewMint",
    "previewWithdraw",
    "previewRedeem",
  ] as const)
    economicUnits(f, before.data[method]);

  for (const method of [
    "previewDeposit",
    "previewMint",
    "previewWithdraw",
    "previewRedeem",
  ] as const)
    expect(before.data[method].construction).toEqual(before.data.context);

  const context = toPlannerContext(economic.construction, "ctvs1");

  expect(context.stateInput.ref).toEqual(before.basis.stateRef);

  const plan = buildDirectPlan({
    ...context,
    operation: step.operation,
    amount: step.amount,
    bound: step.bound,
    receiver: f.installed.receiver,
    receiverTopup: 2000000n,
  });

  expect(plan.economicEffects).toEqual(economic.quote);
  expect(plan.approvedBound).toBe(step.bound);

  const record = await execute(f, `direct-${step.operation}`, plan);

  await freeze(primary(f.env));

  const after = await synced(
    () => f.vault.read(requested),
    (value) => value.data.snapshot.state.sequence === step.sequence,
    `direct ${step.operation} State`,
  );

  await verifyOutputs(f, step, before, after, record, plan);
  await expect(f.vault.read(requested, { expectedBasis: before.basis })).rejects.toMatchObject({
    code: "STALE_BASIS",
  });

  const fresh = createIndexerClient({
    baseUrl: queryUrl,
    expectedNetwork: f.env.config.network,
  }).vault(f.installed.deployment.policy);

  expect(await fresh.read(requested, { expectedBasis: after.basis })).toEqual(after);
  replay(f, requested, after, `direct-${step.operation}`);
  write(f.env.directory, `direct-${step.operation}-sdk`, { step, before, after, plan });

  return { operation: step.operation, txId: record.txId, response: after };
}

export async function directLifecycle(f: Flow, chain: Awaited<ReturnType<typeof capture>>) {
  const responses = [];

  for (const step of steps) {
    responses.push(await direct(f, step));

    if (step.operation !== "redeem") forge(primary(f.env));
  }

  await receipts(f, chain);

  const status = await lookupReady(f.env, "ctvs1-direct-final");

  await nativeInventory(f);

  write(f.env.directory, "ctvs1-direct-result", {
    passed: true,
    network: f.env.config.network,
    bootstrap: f.env.config.intersection,
    deployment: f.installed.deployment,
    underlying: f.installed.terms.underlying,
    responses,
    status,
    stages: f.receipts.map(({ stage, txId, bytes, evaluations }) => ({
      stage,
      txId,
      bytes,
      evaluations,
      nodeAccepted: true,
    })),
    coverage: ["direct mint", "direct withdraw", "direct redeem", "stateless replay"],
  });

  return responses;
}
