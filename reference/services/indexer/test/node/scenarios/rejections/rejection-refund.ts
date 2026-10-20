/** Controller, deadline, destination and whole-value refund obligations for valid and opaque Requests. */
import assert from "node:assert/strict";
import { buildRefundPlanFromCbor } from "@ctvs/ctvs2";
import type { ReadQueries } from "@ctvs/integration/query";
import {
  assetId,
  bytes,
  constr,
  enterprise,
  MAGIC,
  type OutRef,
  recoveryData,
  refundRedeemer,
} from "@ctvs/protocol";
import { expect } from "vitest";
import {
  datumHex,
  ledgerAddress,
  ledgerValue,
} from "../../../../../../testing/ledger/serialization.js";
import { underlyingValue } from "../../support/assets.js";
import type { Flow } from "../../support/flow.js";
import { forge, primary } from "../../support/fork.js";
import { submit } from "../../support/wallet.js";
import type { Actor } from "./rejection-common.js";
import { acceptControl, rejectionPoint, rejectionValidity } from "./rejection-control.js";
import { output } from "./rejection-mutations.js";
import { rejectVariants } from "./rejection-runner.js";
import { rejectSpent } from "./rejection-spent.js";

async function refundPlan(f: Flow, ref: OutRef) {
  const raw = (await f.vault.recoverySource({ ref })).data;

  assert.equal(raw.deployment.family, "ctvs2");

  if (raw.deployment.family !== "ctvs2") throw new Error("wrong family");

  return buildRefundPlanFromCbor({
    ...raw,
    deployment: raw.deployment,
    mode: "cancel",
    validity: rejectionValidity(f),
  });
}

export async function refundRejections(
  f: Flow,
  requested: ReadQueries,
  refs: [OutRef, OutRef],
  actor: Actor,
) {
  const ref = refs[0];
  const selected = { ...requested, request: { ref }, recoverySource: { ref } };
  const plan = await refundPlan(f, ref);
  const result = await rejectVariants(f, selected, plan, [
    {
      label: "cancel-missing-controller",
      select: actor.select,
      mutate: (candidate) => {
        candidate.requiredSigners = [];
      },
    },
    {
      label: "early-permissionless-expiry",
      select: actor.select,
      mutate: (candidate) => {
        const input = candidate.inputs[0];

        assert.ok(input);
        input.redeemer = refundRedeemer("expiry", 0n);
        candidate.requiredSigners = [];
      },
    },
    {
      label: "redirected-refund",
      mutate: (candidate) => {
        output(candidate, 0).address = enterprise(actor.hash, "key");
      },
    },
    {
      label: "partial-refund",
      mutate: (candidate) => {
        const value = output(candidate, 0).value;
        const unit = assetId(f.installed.terms.underlying);

        value[unit] = (value[unit] ?? 0n) - 1n;
      },
    },
  ]);
  const afterQueries = { ...requested, request: { ref } };

  const accepted = await acceptControl(f, afterQueries, "accepted-cancel-control", plan);

  expect(accepted.receipt.txId).not.toBe(result.control.txId);
  await expect(f.vault.recoverySource({ ref })).rejects.toMatchObject({ code: "NOT_FOUND" });

  const spent = await rejectSpent(
    f,
    afterQueries,
    { ...result.control, label: "spent-request" },
    ref,
  );

  await acceptControl(
    f,
    { ...requested, request: { ref: refs[1] } },
    "accepted-second-cancel",
    await refundPlan(f, refs[1]),
  );

  return [...result.rejected, spent];
}

export async function opaqueRejections(f: Flow, requested: ReadQueries, actor: Actor) {
  const controller = f.installed.terms.pauseKey;

  assert.ok(controller);
  f.w.selectOwner();
  forge(primary(f.env));

  const datum = constr(1, [
    bytes(MAGIC),
    2n,
    recoveryData({
      vaultPolicy: f.installed.deployment.policy,
      controller,
      refund: f.installed.receiver,
      deadlinePosixMs: rejectionValidity(f).upperPosixMs + 600000n,
    }),
    constr(999, [bytes("aabb"), -1n]),
  ]);
  const receipt = await submit(
    f.env.directory,
    "opaque-guard-request",
    f.w.lucid.newTx().pay.ToAddressWithData(
      ledgerAddress(enterprise(f.installed.deployment.policy)),
      { kind: "inline", value: datumHex(datum) },
      {
        ...ledgerValue(
          underlyingValue(f, f.installed.terms.underlying === "ada" ? 0n : 4321n, 5000000n),
        ),
        [f.installed.unit]: 1234n,
      },
    ),
    f.w.provider,
  );

  f.receipts.push(receipt);

  const ref = { txId: receipt.txId, index: 0n };
  const selected = { ...requested, request: { ref }, recoverySource: { ref } };
  const before = await rejectionPoint(f, selected, "opaque-rejection-baseline");

  expect(before.data.request.validation.status).toBe("unsupported");

  const plan = await refundPlan(f, ref);
  const result = await rejectVariants(f, selected, plan, [
    {
      label: "opaque-refund-recipient",
      mutate: (candidate) => {
        output(candidate, 0).address = enterprise(actor.hash, "key");
      },
    },
    {
      label: "opaque-refund-unrelated-asset-theft",
      mutate: (candidate) => {
        const value = output(candidate, 0).value;
        const unit = `${f.installed.unit.slice(0, 56)}.${f.installed.unit.slice(56)}`;

        value[unit] = (value[unit] ?? 0n) - 1n;
      },
    },
  ]);

  await acceptControl(f, { ...requested, request: { ref } }, "accepted-opaque-cancel", plan);

  return result.rejected;
}
