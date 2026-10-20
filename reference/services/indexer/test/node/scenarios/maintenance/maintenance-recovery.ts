/** Actual peer-selected maintenance forks restore custody and availability without client recovery state. */
import { readAcceptedTransaction } from "@ctvs/integration";
import type { OutRef } from "@ctvs/protocol";
import { expect } from "vitest";
import { nativeInventory, stateCustody } from "../../support/assets.js";
import { capture } from "../../support/capture.js";
import { eventually, write } from "../../support/environment.js";
import { type Flow, type peer, readback } from "../../support/flow.js";
import { checkpoint, type ForkNode } from "../../support/fork.js";
import { reconcileFork } from "../../support/lookup.js";
import { statelessRead } from "../../support/persistence.js";
import {
  type MaintenanceRead,
  type maintenanceRead,
  maintenanceStep,
  maintenanceSteps,
  maintenanceViews,
} from "./maintenance.js";

type Requested = ReturnType<typeof maintenanceRead>;
type Actor = Awaited<ReturnType<typeof peer>>;

export async function maintenanceForks(
  f: Flow,
  requested: Requested,
  baseline: MaintenanceRead,
  actor: Actor,
  copies: ForkNode[],
) {
  const branches = [];
  let before = baseline;

  for (const step of maintenanceSteps) {
    const fork = await checkpoint(f.env, `before-${step.stage}`, copies);
    const after = await maintenanceStep(f, requested, before, step, actor);
    const receipt = f.receipts.at(-1);

    expect(receipt?.stage).toBe(step.stage);

    if (!receipt) throw new Error("maintenance receipt missing");

    branches.push({ fork, step, receipt, before, after });
    before = after;
  }

  return branches;
}

type Branch = Awaited<ReturnType<typeof maintenanceForks>>[number];

/** Both the installed Kupo provider and the node ledger must drop every orphan output. */
export async function absentMaintenance(f: Flow, refs: OutRef[]) {
  expect(
    await f.w.provider.getUtxosByOutRef(
      refs.map((ref) => ({ txHash: ref.txId, outputIndex: Number(ref.index) })),
    ),
  ).toEqual([]);
  expect(
    JSON.parse(
      f.env.cli(
        "conway",
        "query",
        "utxo",
        ...refs.flatMap((ref) => ["--tx-in", `${ref.txId}#${ref.index}`]),
        "--testnet-magic",
        "42",
        "--socket-path",
        "/ipc/node.socket",
        "--out-file",
        "/dev/stdout",
      ),
    ),
  ).toEqual({});
}

export async function reverseMaintenance(f: Flow, requested: Requested, branch: Branch) {
  const label = `rollback-${branch.step.stage}`;
  const before = await f.vault.read(requested);
  const chain = await capture(f.env.config, f.env.directory, `${label}-events`);

  try {
    await eventually(
      async () => (chain.observed.has(branch.receipt.txId) ? true : undefined),
      "capture observed current maintenance transaction",
    );
    await reconcileFork(f, branch.fork.node, label, requested);

    const after = await statelessRead(f, requested, label);

    expect(after.basis.instance).toBe(before.basis.instance);
    expect(after.basis.recoveryGeneration).toBeGreaterThan(before.basis.recoveryGeneration);
    expect(after.basis.stateRef).toEqual(branch.before.basis.stateRef);
    expect(after.data.snapshot).toEqual(branch.before.data.snapshot);
    expect(after.data.context.stateInput).toEqual(branch.before.data.context.stateInput);
    expect(after.data.context.deployment).toEqual({
      ...branch.before.data.context.deployment,
      chainPoint: after.basis.chainPoint,
    });
    expect(after.data.ownership).toEqual(branch.before.data.ownership);
    expect(after.data.request).toEqual(branch.before.data.request);
    expect(after.data.claim).toEqual(branch.before.data.claim);
    expect(after.data.context.stateInput.value).toEqual(stateCustody(f, after.data.snapshot.state));
    maintenanceViews(f, after, branch.before);
    await readback(f, `${label}-state`, after.basis.stateRef, after.data.context.stateInput);
    await readback(f, `${label}-config`, after.data.context.deployment.configRef);
    await nativeInventory(f, branch.before.data.snapshot.state.storageLovelace);
    await expect(f.vault.read(requested, { expectedBasis: before.basis })).rejects.toMatchObject({
      code: "STALE_BASIS",
    });

    const accepted = readAcceptedTransaction(branch.receipt.signedCbor);
    const restored = await f.w.provider.getUtxosByOutRef(
      accepted.inputs.map((ref) => ({ txHash: ref.txId, outputIndex: Number(ref.index) })),
    );

    expect(restored.map((utxo) => `${utxo.txHash}#${utxo.outputIndex}`).sort()).toEqual(
      accepted.inputs.map((ref) => `${ref.txId}#${ref.index}`).sort(),
    );
    await absentMaintenance(
      f,
      accepted.outputs.map((_, index) => ({ txId: branch.receipt.txId, index: BigInt(index) })),
    );
    await eventually(
      async () =>
        chain.rollbacks.find((event) => event.point.blockHash === branch.fork.common.blockHash),
      "real maintenance rollback message",
    );
    expect(chain.failures).toEqual([]);
    write(f.env.directory, `${label}-result`, {
      passed: true,
      step: branch.step,
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

/** The first replacement pause differs from the orphan and consumes its restored State input. */
export async function replaceMaintenance(
  f: Flow,
  requested: Requested,
  before: MaintenanceRead,
  actor: Actor,
  producer: ForkNode,
) {
  let after = before;

  for (const step of maintenanceSteps.slice(1))
    after = await maintenanceStep(
      f,
      requested,
      after,
      { ...step, stage: `replacement-${step.stage}` },
      actor,
      producer,
    );

  return after;
}
