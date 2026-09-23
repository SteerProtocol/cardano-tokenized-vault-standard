/** Signed local CTVS-2 lifecycles separate economic settlement from State-independent recovery. */
import {
  buildCollectFeesPlan,
  buildRefundPlan,
  buildSetPausePlan,
  buildTopUpReservePlan,
} from "@ctvs/ctvs2";
import { bytes, constr, MAGIC, recoveryData, stateFromData } from "@ctvs/protocol";
import { describe, expect, it } from "vitest";
import { settleAndDeliver } from "../../fixtures/requests.js";
import { createVault, surplusUnit } from "../../fixtures/vault.js";
import { datumHex, protocolValue } from "../../ledger/serialization.js";

describe.each(["ada", "native"] as const)("CTVS-2 signed %s transactions", (underlying) => {
  it("settles deposits and redemptions into authenticated funded Claims", async () => {
    const vault = await createVault("ctvs2", underlying, "settlement-lifecycle");
    const deposit = await settleAndDeliver(vault, "deposit", 101_000_000n, 100_000_000n);

    expect(deposit.economicQuantity).toBe(100_000_000n);

    const redemption = await settleAndDeliver(vault, "redeem", 10_000_000n, 9_900_000n);

    expect(redemption.economicQuantity).toBeGreaterThanOrEqual(9_900_000n);

    const state = stateFromData((await vault.stateInput()).datum);

    expect(state.economicSupply).toBe(90_000_000n);
    expect(state.backingAssets).toBe(90_000_000n);
    expect(state.accruedFees).toBeGreaterThan(1_000_000n);
    await vault.submit(
      "collect-fees",
      buildCollectFeesPlan({ ...(await vault.asyncContext()), receiverTopup: 2_000_000n }),
    );
    await vault.submit(
      "top-up",
      buildTopUpReservePlan({ ...(await vault.asyncContext()), additionalLovelace: 1_000_000n }),
    );
    await vault.submit(
      "pause",
      buildSetPausePlan({ ...(await vault.asyncContext()), pauseFlags: 3n }),
    );
    await vault.submit(
      "unpause",
      buildSetPausePlan({ ...(await vault.asyncContext()), pauseFlags: 0n }),
    );
  });
});

describe.each(["ada", "native"] as const)("CTVS-2 signed %s transactions", (underlying) => {
  it("recovers unsupported economics with controller cancellation and permissionless expiry", async () => {
    const vault = await createVault("ctvs2", underlying, "independent-recovery");
    const context = await vault.asyncContext(),
      before = await vault.stateInput();
    const deadline = vault.emulator.now() + 100_000;
    const recovery = {
      vaultPolicy: vault.policy,
      controller: vault.userKey,
      refund: vault.receiver,
      deadlinePosixMs: BigInt(deadline),
    };
    const datum = constr(1, [
      bytes(MAGIC),
      2n,
      recoveryData(recovery),
      constr(999, [bytes("aabb"), -1n]),
    ]);
    const assets = { lovelace: 5_000_000n, [surplusUnit]: 1234n };
    const fundingAuthorization = await vault.authorize(
      null,
      [0, 1].map(() => ({
        address: vault.vaultAddress,
        value: protocolValue(assets),
        datum: { kind: "inline" as const, cbor: datumHex(datum) },
        referenceScript: null,
      })),
    );
    const funding = await vault.recorder.submit(
      "candidate-requests",
      vault.lucid
        .newTx()
        .pay.ToAddressWithData(
          vault.vaultAddress,
          { kind: "inline", value: datumHex(datum) },
          assets,
        )
        .pay.ToAddressWithData(
          vault.vaultAddress,
          { kind: "inline", value: datumHex(datum) },
          assets,
        ),
      { plan: null, authorization: fundingAuthorization },
    );
    const first = await vault.output(funding),
      second = await vault.output(funding, 1);
    const cancel = await vault.submit(
      "cancel",
      buildRefundPlan({
        deployment: context.deployment,
        source: await vault.protectedInput(first),
        mode: "cancel",
        validity: {
          lowerPosixMs: BigInt(vault.emulator.now()),
          upperPosixMs: BigInt(vault.emulator.now() + 60_000),
        },
      }),
    );

    expect((await vault.output(cancel)).assets).toEqual(assets);
    vault.emulator.awaitSlot(Math.max(0, Math.ceil((deadline - vault.emulator.now()) / 1000)));
    vault.lucid.selectWallet.fromPrivateKey(vault.publisher.privateKey);

    const expiry = await vault.submit(
      "expiry",
      buildRefundPlan({
        deployment: context.deployment,
        source: await vault.protectedInput(second),
        mode: "expiry",
        validity: {
          lowerPosixMs: BigInt(vault.emulator.now()),
          upperPosixMs: BigInt(vault.emulator.now() + 60_000),
        },
      }),
    );

    expect((await vault.output(expiry)).assets).toEqual(assets);

    const record = vault.recorder.accepted.find((entry) => entry.stage === "expiry");

    expect(record?.requiredSigners).toEqual([]);
    expect(record?.witnesses).not.toContain(vault.userKey);
    expect(await vault.stateInput()).toEqual(before);
    expect(protocolValue((await vault.emulator.getUtxoByUnit(vault.idUnit)).assets)).toEqual({
      ada: 10_000_000n,
      [`${vault.policy}.4944`]: 1n,
    });
  });
});
