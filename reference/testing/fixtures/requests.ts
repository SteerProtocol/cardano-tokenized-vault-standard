/** Funds and spends actual emulator UTxOs to exercise Request settlement and subsequent Claim delivery. */
import { buildBatchPlan, buildDeliverPlan, buildRequestPlan } from "@ctvs/ctvs2";
import { claimFromData, decodeData, type Request, type RequestKind } from "@ctvs/protocol";
import { getAddressDetails } from "@lucid-evolution/lucid";
import { expect } from "vitest";
import { asRef } from "../ledger/serialization.js";
import type { VaultFixture } from "./vault.js";

/**
 * Submit an independently funded Request and return its actual output reference.
 * Amount/minimum units follow kind; storage and execution ADA are fixed fixture
 * budgets. Request creation leaves State untouched and does not guarantee settlement.
 */
export async function fundRequest(
  vault: VaultFixture,
  kind: RequestKind,
  offered: bigint,
  minimumOutput: bigint,
  suffix = "",
) {
  const context = await vault.asyncContext();
  const request: Request = {
    recovery: {
      vaultPolicy: vault.policy,
      controller: vault.userKey,
      refund: vault.receiver,
      deadlinePosixMs: BigInt(vault.emulator.now() + 180_000),
    },
    body: {
      termsHash: vault.deployment.termsHash,
      kind,
      offered,
      minimumOutput,
      receiver: vault.receiver,
      storageLovelace: 5_000_000n,
      executionBudget: 2_000_000n,
      settlerFee: 100_000n,
    },
  };
  const txId = await vault.submit(
    `request-${kind}${suffix}`,
    buildRequestPlan({ ...context, request }),
  );

  return { request, utxo: await vault.output(txId) };
}

/**
 * Execute funding, snapshot settlement and delivery as three separately signed steps.
 * The publisher acts as settler so reward authority is distinct from receiver ownership.
 * Claim origin/carry assertions link the steps; the final State equality proves delivery
 * discharges a fixed obligation without repricing or consuming State again.
 */
export async function settleAndDeliver(
  vault: VaultFixture,
  kind: RequestKind,
  offered: bigint,
  minimumOutput: bigint,
) {
  const before = await vault.stateInput();
  const { request, utxo } = await fundRequest(vault, kind, offered, minimumOutput);

  expect(await vault.stateInput()).toEqual(before);

  const publisherKey = getAddressDetails(vault.publisher.address).paymentCredential?.hash;

  if (!publisherKey) throw new Error("Missing settler key");

  vault.lucid.selectWallet.fromPrivateKey(vault.publisher.privateKey);

  const context = await vault.asyncContext();
  const batch = buildBatchPlan({
    ...context,
    requests: [{ input: await vault.protectedInput(utxo) }],
    rewardKey: publisherKey,
    rewardTopup: 2_000_000n,
    validity: {
      lowerPosixMs: BigInt(vault.emulator.now()),
      upperPosixMs: request.recovery.deadlinePosixMs,
    },
  });
  const settled = await vault.submit(`settle-${kind}`, batch);
  const claim = await vault.output(settled, 1);

  if (!claim.datum) throw new Error("Missing funded Claim datum");

  const datum = claimFromData(decodeData(claim.datum));

  expect(datum.requestRef).toEqual(asRef(utxo));
  expect(datum.stateRef).toEqual(before.ref);
  expect(datum.carriedLovelace).toBe(6_900_000n);

  const afterSettlement = await vault.stateInput();

  vault.lucid.selectWallet.fromPrivateKey(vault.user.privateKey);

  const delivered = await vault.submit(
    `deliver-${kind}`,
    buildDeliverPlan({
      deployment: context.deployment,
      claims: [await vault.protectedInput(claim)],
    }),
  );

  expect((await vault.output(delivered)).assets).toEqual(claim.assets);
  expect(await vault.stateInput()).toEqual(afterSettlement);

  return datum;
}
