/** Both escrows and both gross Claims must reverse, including zero-net batches without a mint policy. */
import assert from "node:assert/strict";
import { readAcceptedTransaction, toPlannerInput } from "@ctvs/integration";
import { assetId } from "@ctvs/protocol";
import { expect } from "vitest";
import { stateCustody } from "../../support/assets.js";
import { write } from "../../support/environment.js";
import { type Flow, type Receipt, readback } from "../../support/flow.js";
import { absentMaintenance } from "../maintenance/maintenance-recovery.js";
import type { BatchBranch, replaceBatch } from "./batch-forks.js";
import { type BatchPair, batchViews } from "./batch-read.js";

export async function restoredBatch(
  f: Flow,
  branch: BatchBranch,
  actual: BatchPair,
  phase: "delivery" | "settlement",
  label: string,
) {
  const expected = phase === "delivery" ? branch.fixed : branch.before;

  for (const [index, response] of actual.entries()) {
    const prior = expected[index];

    expect(response.basis.stateRef).toEqual(prior?.basis.stateRef);
    expect(response.data.snapshot).toEqual(prior?.data.snapshot);
    expect(response.data.context.stateInput).toEqual(prior?.data.context.stateInput);
    expect(response.data.context.deployment).toEqual({
      ...prior?.data.context.deployment,
      chainPoint: response.basis.chainPoint,
    });
    expect(response.data.ownership).toEqual(prior?.data.ownership);
    expect(response.data.request).toEqual(prior?.data.request);
    expect(response.data.claim).toEqual(prior?.data.claim);
    expect(response.data.request.completion).toBeNull();

    if (phase === "delivery") {
      expect(response.data.claim.unspent).toBe(true);
      expect(response.data.request.status).toBe("claimable");
      expect(toPlannerInput(response.data.claim).ref).toEqual(response.data.claim.ref);
      await readback(
        f,
        `${label}-claim-${index}`,
        response.data.claim.ref,
        response.data.claim.source,
      );
    } else {
      expect(response.data.request.status).toBe("pending_escrow");
      expect(response.data.request.settlement).toBeNull();
      expect(toPlannerInput(response.data.request).ref).toEqual(response.data.request.ref);
      await readback(
        f,
        `${label}-request-${index}`,
        response.data.request.ref,
        response.data.request.source,
      );

      const claimRef = branch.claims[index];

      assert.ok(claimRef);
      await expect(f.vault.claim({ ref: claimRef })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    }
  }

  expect(actual[0].data.context.stateInput.value).toEqual(
    stateCustody(f, actual[0].data.snapshot.state),
  );
  batchViews(f, branch.step, actual);
  await readback(f, `${label}-state`, actual[0].basis.stateRef, actual[0].data.context.stateInput);
  await readback(f, `${label}-config`, actual[0].data.context.deployment.configRef);
}

export async function finalBatch(
  f: Flow,
  branches: BatchBranch[],
  accepted: Awaited<ReturnType<typeof replaceBatch>>,
  final: BatchPair,
) {
  const first = branches[0];

  assert.ok(first);
  expect(final[0].data.snapshot.state).toEqual(first.fixed[0].data.snapshot.state);
  expect(final[0].data.ownership).toEqual(first.after[0].data.ownership);

  for (const [index, ref] of accepted.refs.entries()) {
    expect(final[index]?.data.request.settlement?.claimRef.txId).toBe(accepted.txId);
    expect(final[index]?.data.request.ref).toEqual(ref);
  }

  for (const branch of branches) {
    for (const ref of branch.claims)
      await expect(f.vault.claim({ ref })).rejects.toMatchObject({ code: "NOT_FOUND" });

    if (branch !== first)
      for (const ref of branch.refs)
        await expect(f.vault.request({ ref })).rejects.toMatchObject({ code: "NOT_FOUND" });
  }

  await absentMaintenance(
    f,
    branches.flatMap((branch) =>
      [branch.settled, branch.delivered].flatMap((receipt) =>
        readAcceptedTransaction(receipt.signedCbor).outputs.map((_, index) => ({
          txId: receipt.txId,
          index: BigInt(index),
        })),
      ),
    ),
  );
}

export async function restoredInputs(f: Flow, receipt: Receipt, label: string) {
  const tx = readAcceptedTransaction(receipt.signedCbor);
  const restored = await f.w.provider.getUtxosByOutRef(
    tx.inputs.map((ref) => ({ txHash: ref.txId, outputIndex: Number(ref.index) })),
  );

  expect(restored.map((utxo) => `${utxo.txHash}#${utxo.outputIndex}`).sort()).toEqual(
    tx.inputs.map((ref) => `${ref.txId}#${ref.index}`).sort(),
  );
  await absentMaintenance(
    f,
    tx.outputs.map((_, index) => ({ txId: receipt.txId, index: BigInt(index) })),
  );
  write(f.env.directory, `${label}-inputs`, { restored, orphan: receipt.txId });
}

/** Include pending escrow or funded Claims outside State when accounting for native custody. */
export async function rollbackInventory(f: Flow, pair: BatchPair, label: string) {
  if (f.installed.terms.underlying === "ada") return;

  f.w.selectOwner();

  const asset = assetId(f.installed.terms.underlying);
  const outputs = await f.w.lucid.wallet().getUtxos();
  const wallet = outputs.reduce(
    (total, row) => total + (row.assets[asset.replace(".", "")] ?? 0n),
    0n,
  );
  const state = pair[0].data.context.stateInput.value[asset] ?? 0n;
  const escrow = pair.reduce(
    (total, row) =>
      total + (row.data.request.unspent ? (row.data.request.source.value[asset] ?? 0n) : 0n),
    0n,
  );
  const claims = pair.reduce(
    (total, row) =>
      total + (row.data.claim?.unspent ? (row.data.claim.source.value[asset] ?? 0n) : 0n),
    0n,
  );
  const unrelated = outputs.reduce(
    (total, row) => total + (row.assets[f.installed.unit] ?? 0n),
    0n,
  );

  expect(wallet + state + escrow + claims).toBe(9007199254740993n);
  expect(unrelated).toBe(9007199254740993n);
  write(f.env.directory, `${label}-inventory`, {
    initial: 9007199254740993n,
    wallet,
    state,
    escrow,
    claims,
    unrelated,
  });
}
