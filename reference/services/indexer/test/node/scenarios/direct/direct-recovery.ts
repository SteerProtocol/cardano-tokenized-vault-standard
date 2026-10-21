/** Direct native operations and their inverse custody checks on real replacement branches. */
import assert from "node:assert/strict";
import { buildDirectPlan } from "@ctvs/ctvs1";
import { readAcceptedTransaction, toPlannerContext } from "@ctvs/integration";
import { NAMES } from "@ctvs/protocol";
import { expect } from "vitest";
import { underlyingValue } from "../../support/assets.js";
import { capture } from "../../support/capture.js";
import { eventually, write } from "../../support/environment.js";
import { execute, type Flow, readback } from "../../support/flow.js";
import { checkpoint, type ForkNode, forge, freeze, primary } from "../../support/fork.js";
import { reconcileFork } from "../../support/lookup.js";
import { economicRead, statelessRead } from "../../support/persistence.js";
import { recoveryCustody } from "../async/recovery-custody.js";
import { mintedShares } from "./direct-lifecycle.js";

const steps = [
  {
    operation: "deposit",
    method: "previewDeposit",
    amount: 101000000n,
    bound: 100000000n,
    backing: 100000000n,
    fees: 1000000n,
    shares: 100000000n,
    net: 100000000n,
  },
  {
    operation: "mint",
    method: "previewMint",
    amount: 13333337n,
    bound: 13466671n,
    backing: 113333337n,
    fees: 1133334n,
    shares: 13333337n,
    net: 13333337n,
  },
  {
    operation: "withdraw",
    method: "previewWithdraw",
    amount: 7777777n,
    bound: 7855555n,
    backing: 105477782n,
    fees: 1211112n,
    shares: -7855555n,
    net: 7777777n,
  },
  {
    operation: "redeem",
    method: "previewRedeem",
    amount: 5555557n,
    bound: 5500551n,
    backing: 99922225n,
    fees: 1266118n,
    shares: -5555557n,
    net: 5500551n,
  },
] as const;

type Step = (typeof steps)[number];

async function direct(f: Flow, step: Step, label: string) {
  const requested = economicRead(f);
  const before = await statelessRead(f, requested, `${label}-before`);
  const preview = await f.vault.read({
    previewDeposit: { assets: step.amount },
    previewMint: { shares: step.amount },
    previewWithdraw: { assets: step.amount },
    previewRedeem: { shares: step.amount },
  });
  const quote = preview.data[step.method];

  expect(quote.result).toEqual({ status: "known", value: step.bound });

  const plan = buildDirectPlan({
    ...toPlannerContext(before.data.context, "ctvs1"),
    operation: step.operation,
    amount: step.amount,
    bound: step.bound,
    receiver: f.installed.receiver,
    receiverTopup: 2000000n,
  });

  expect(plan.economicEffects).toEqual(quote.quote);

  forge(primary(f.env));

  const receipt = await execute(f, label, plan);

  await freeze(primary(f.env));

  const after = await statelessRead(f, requested, `${label}-after`);
  const state = after.data.snapshot.state;

  expect(state).toMatchObject({
    backingAssets: step.backing,
    economicSupply: step.backing,
    accruedFees: step.fees,
  });
  expect(state.sequence).toBe(before.data.snapshot.state.sequence + 1n);
  expect(after.data.ownership.freeShares).toBe(step.backing);
  expect(mintedShares(receipt.signedCbor, f.installed.deployment.policy)).toBe(step.shares);
  await recoveryCustody(f, after, label);
  await readback(
    f,
    `${label}-receiver`,
    { txId: receipt.txId, index: 1n },
    {
      value:
        step.shares > 0n
          ? { ada: 2000000n, [`${f.installed.deployment.policy}.${NAMES.share}`]: step.shares }
          : underlyingValue(f, step.net, 2000000n),
      datumCbor: null,
    },
  );
  await expect(f.vault.read(requested, { expectedBasis: before.basis })).rejects.toMatchObject({
    code: "STALE_BASIS",
  });

  return { step, before, after, receipt };
}

export async function directForks(f: Flow, copies: ForkNode[]) {
  const branches = [];

  for (const step of steps) {
    const fork = await checkpoint(f.env, `before-${step.operation}`, copies);

    branches.push({ fork, ...(await direct(f, step, `original-${step.operation}`)) });
  }

  return branches;
}

type Branch = Awaited<ReturnType<typeof directForks>>[number];

export async function reverseDirect(f: Flow, branch: Branch) {
  const label = `rollback-${branch.step.operation}`;
  const requested = economicRead(f);
  const before = await f.vault.read(requested);
  const chain = await capture(f.env.config, f.env.directory, `${label}-events`);

  try {
    await eventually(
      async () => (chain.observed.has(branch.receipt.txId) ? true : undefined),
      "capture observed current direct transaction",
    );
    await reconcileFork(f, branch.fork.node, label, requested);

    const after = await statelessRead(f, requested, label);

    expect(after.basis.instance).toBe(before.basis.instance);
    expect(after.basis.recoveryGeneration).toBeGreaterThan(before.basis.recoveryGeneration);
    expect(after.data.snapshot).toEqual(branch.before.data.snapshot);
    expect(after.data.context.stateInput).toEqual(branch.before.data.context.stateInput);
    expect(after.data.ownership).toEqual(branch.before.data.ownership);
    await recoveryCustody(f, after, label);
    await expect(f.vault.read(requested, { expectedBasis: before.basis })).rejects.toMatchObject({
      code: "STALE_BASIS",
    });

    const inputs = readAcceptedTransaction(branch.receipt.signedCbor).inputs;
    const restored = await f.w.provider.getUtxosByOutRef(
      inputs.map((ref) => ({ txHash: ref.txId, outputIndex: Number(ref.index) })),
    );

    expect(restored.map((utxo) => `${utxo.txHash}#${utxo.outputIndex}`).sort()).toEqual(
      inputs.map((ref) => `${ref.txId}#${ref.index}`).sort(),
    );
    expect(
      await f.w.provider.getUtxosByOutRef(
        [0, 1].map((outputIndex) => ({ txHash: branch.receipt.txId, outputIndex })),
      ),
    ).toEqual([]);
    await eventually(
      async () =>
        chain.rollbacks.find((event) => event.point.blockHash === branch.fork.common.blockHash),
      "real direct rollback message",
    );
    expect(chain.failures).toEqual([]);
    write(f.env.directory, `${label}-result`, {
      passed: true,
      before,
      after,
      common: branch.fork.common,
      rollbacks: chain.rollbacks,
      restoredInputs: restored,
      orphan: branch.receipt.txId,
    });

    return after;
  } finally {
    await chain.close();
  }
}

export async function replaceDirect(f: Flow, node: ForkNode) {
  forge(node);

  const receipt = await execute(
    f,
    "replacement-deposit",
    buildDirectPlan({
      ...toPlannerContext((await f.vault.context()).data, "ctvs1"),
      operation: "deposit",
      amount: 50500000n,
      bound: 50000000n,
      receiver: f.installed.receiver,
      receiverTopup: 2000000n,
    }),
  );

  await freeze(node);

  const after = await statelessRead(f, economicRead(f), "replacement");

  expect(after.data.snapshot.state).toMatchObject({
    sequence: 1n,
    backingAssets: 50000000n,
    economicSupply: 50000000n,
    accruedFees: 500000n,
  });
  expect(after.basis.stateRef).toEqual({ txId: receipt.txId, index: 0n });
  expect(after.data.ownership.freeShares).toBe(50000000n);
  await recoveryCustody(f, after, "replacement");
  assert.notEqual(receipt.txId, f.receipts.find((row) => row.stage === "original-deposit")?.txId);

  return receipt;
}
