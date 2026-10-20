/** Full-value recovery with unsupported economics; expiry uses a distinct signer. */
import assert from "node:assert/strict";
import { buildRefundPlanFromCbor } from "@ctvs/ctvs2";
import { readAcceptedTransaction, toPlannerContext } from "@ctvs/integration";
import type { OutRef } from "@ctvs/protocol";
import { bytes, constr, MAGIC, recoveryData } from "@ctvs/protocol";
import { CML } from "@lucid-evolution/lucid";
import { expect } from "vitest";
import {
  datumHex,
  ledgerAddress,
  ledgerValue,
} from "../../../../../../testing/ledger/serialization.js";
import { underlyingValue } from "../../support/assets.js";
import { write } from "../../support/environment.js";
import { execute, type Flow, type peer, readback, synced, validity } from "../../support/flow.js";
import { submit } from "../../support/wallet.js";
import { create } from "./async-lifecycle.js";

async function candidates(f: Flow) {
  f.w.selectOwner();

  const context = toPlannerContext((await f.vault.context()).data, "ctvs2");
  const controller = f.installed.terms.pauseKey;

  assert.ok(controller);

  const bounds = validity(f.w);
  const datums = [bounds.upperPosixMs + 120000n, bounds.lowerPosixMs - 2000n].map(
    (deadlinePosixMs) =>
      constr(1, [
        bytes(MAGIC),
        2n,
        recoveryData({
          vaultPolicy: context.deployment.policy,
          controller,
          refund: f.installed.receiver,
          deadlinePosixMs,
        }),
        constr(999, [bytes("aabb"), -1n]),
      ]),
  );
  let builder = f.w.lucid.newTx();

  for (const datum of datums)
    builder = builder.pay.ToAddressWithData(
      ledgerAddress({ payment: { type: "script", hash: context.deployment.policy }, stake: null }),
      { kind: "inline", value: datumHex(datum) },
      {
        ...ledgerValue(
          underlyingValue(f, f.installed.terms.underlying === "ada" ? 0n : 4321n, 5000000n),
        ),
        [f.installed.unit]: 1234n,
      },
    );

  const created = await submit(f.env.directory, "recovery-candidates", builder, f.w.provider);

  f.receipts.push(created);

  return datums.map((_datum, index) => ({ txId: created.txId, index: BigInt(index) }));
}

function signerHashes(cbor: string): string[] {
  const tx = CML.Transaction.from_cbor_hex(cbor);
  const witnesses = tx.witness_set();
  const vkeys = witnesses.vkeywitnesses();
  const hashes: string[] = [];

  try {
    for (let i = 0; i < (vkeys?.len() ?? 0); i++) {
      const witness = vkeys?.get(i);

      assert.ok(witness);

      const key = witness.vkey();
      const hash = key.hash();

      hashes.push(hash.to_hex());
      hash.free();
      key.free();
      witness.free();
    }

    return hashes;
  } finally {
    vkeys?.free();
    witnesses.free();
    tx.free();
  }
}

async function recover(
  f: Flow,
  ref: OutRef,
  mode: "cancel" | "expiry",
  actor: Awaited<ReturnType<typeof peer>>,
  validation: "unsupported" | "valid" = "unsupported",
) {
  const stage = validation === "valid" ? `valid-${mode}` : mode;
  const before = await synced(
    () => f.vault.read({ context: true, request: { ref }, recoverySource: { ref } }),
    (value) => value.data.request.unspent,
    `${mode} candidate`,
  );
  const raw = before.data.recoverySource;

  assert.equal(raw.deployment.family, "ctvs2");

  if (raw.deployment.family !== "ctvs2") throw new Error("wrong family");

  if (validation === "unsupported") {
    expect(before.data.request.request).toBeNull();
    expect(before.data.request.validation.status).toBe("unsupported");
  } else {
    expect(before.data.request.request?.body.kind).toBe("deposit");
    expect(before.data.request.validation).toEqual({ status: "known", value: true });
    expect(raw.source.value).toEqual(underlyingValue(f, 101000000n, 7000000n));
  }

  expect(raw.source.datumCbor).toBe(before.data.request.source.datumCbor);

  if (mode === "cancel") f.w.selectOwner();
  else actor.select();

  const plan = buildRefundPlanFromCbor({
    ...raw,
    deployment: raw.deployment,
    mode,
    validity: validity(f.w),
  });

  expect(plan.referenceInputs).toEqual([]);
  expect(plan.inputs.map((input) => input.ref)).toEqual([ref]);

  const accepted = await execute(f, stage, plan);
  const hashes = signerHashes(accepted.signedCbor);

  if (mode === "expiry") {
    expect(plan.requiredSigners).toEqual([]);
    expect(hashes).toContain(actor.hash);
    expect(hashes).not.toContain(f.installed.terms.pauseKey);
    expect(plan.validity?.lowerPosixMs).toBeGreaterThanOrEqual(
      before.data.request.recovery.deadlinePosixMs,
    );
  } else {
    expect(hashes).toContain(f.installed.terms.pauseKey);
    expect(plan.validity?.upperPosixMs).toBeLessThan(before.data.request.recovery.deadlinePosixMs);
  }

  const after = await synced(
    () => f.vault.read({ context: true, request: { ref } }),
    (value) => value.data.request.status === "refunded",
    `${mode} refund`,
  );

  expect(after.data.context.stateInput).toEqual(before.data.context.stateInput);
  expect(after.data.request.completion?.txId).toBe(accepted.txId);
  expect(after.data.request.unspent).toBe(false);
  await expect(f.vault.recoverySource({ ref })).rejects.toMatchObject({ code: "NOT_FOUND" });

  const tx = readAcceptedTransaction(accepted.signedCbor);

  expect(tx.inputs).not.toContainEqual(before.data.context.stateInput.ref);
  await readback(
    f,
    stage,
    { txId: accepted.txId, index: 0n },
    { value: raw.source.value, datumCbor: null },
  );
  write(f.env.directory, `${stage}-sdk`, { before, after, signerHashes: hashes });
}

export async function recovery(f: Flow, actor: Awaited<ReturnType<typeof peer>>) {
  const [cancel, expiry] = await candidates(f);

  assert.ok(cancel);
  assert.ok(expiry);
  await recover(f, cancel, "cancel", actor);
  await recover(f, expiry, "expiry", actor);

  if (f.installed.terms.underlying !== "ada") {
    f.w.selectOwner();

    const cancel = await create(f, "deposit", 101000000n, 100000000n, {
      stage: "valid-cancel-request",
    });

    await recover(f, cancel.ref, "cancel", actor, "valid");
    f.w.selectOwner();

    const expired = await create(f, "deposit", 101000000n, 100000000n, {
      stage: "valid-expiry-request",
      deadlinePosixMs: validity(f.w).lowerPosixMs - 2000n,
    });

    await recover(f, expired.ref, "expiry", actor, "valid");
  }
}
