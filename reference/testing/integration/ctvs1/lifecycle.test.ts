/** Signed local CTVS-1 lifecycles cover ADA/native custody, maintenance and compiled-validator rejection. */
import {
  buildCollectFeesPlan,
  buildDirectPlan,
  buildSetPausePlan,
  buildTopUpReservePlan,
} from "@ctvs/ctvs1";
import { directRedeemer, enterprise, type Operation, stateFromData } from "@ctvs/protocol";
import { getAddressDetails } from "@lucid-evolution/lucid";
import { describe, expect, it } from "vitest";
import { createVault, type Underlying, type VaultFixture } from "../../fixtures/vault.js";
import { only } from "../../ledger/serialization.js";

async function funded(underlying: Underlying, name: string): Promise<VaultFixture> {
  const vault = await createVault("ctvs1", underlying, name);

  await vault.submit(
    "bootstrap",
    buildDirectPlan({
      ...(await vault.syncContext()),
      operation: "deposit",
      amount: 101_000_000n,
      bound: 100_000_000n,
      receiver: vault.receiver,
      receiverTopup: 2_000_000n,
    }),
  );

  return vault;
}

describe.each(["ada", "native"] as const)("CTVS-1 signed %s transactions", (underlying) => {
  it.each([
    ["deposit", 1_010_000n, 1_000_000n],
    ["mint", 1_000_000n, 1_010_000n],
    ["withdraw", 990_000n, 999_900n],
    ["redeem", 1_000_000n, 990_000n],
  ] satisfies [Operation, bigint, bigint][])(
    "executes %s through its public planner",
    async (operation, amount, bound) => {
      const vault = await funded(underlying, operation);
      const before = stateFromData((await vault.stateInput()).datum);
      const plan = buildDirectPlan({
        ...(await vault.syncContext()),
        operation,
        amount,
        bound,
        receiver: vault.receiver,
        receiverTopup: 2_000_000n,
      });
      const txId = await vault.submit(operation, plan);
      const after = stateFromData((await vault.stateInput()).datum);

      expect(after.sequence).toBe(before.sequence + 1n);
      expect((await vault.output(txId, 1)).address).toBe(vault.user.address);
      expect(
        vault.recorder.evaluator.records.some(
          (record) => record.stage === operation && record.phase === "signed" && record.accepted,
        ),
      ).toBe(true);
      expect(vault.deployment.claimScript).toBeNull();
    },
  );
});

describe.each(["ada", "native"] as const)("CTVS-1 signed %s transactions", (underlying) => {
  it("collects fees, tops up reserves, and applies authorized pause changes", async () => {
    const vault = await funded(underlying, "maintenance");

    await vault.submit(
      "collect-fees",
      buildCollectFeesPlan({ ...(await vault.syncContext()), receiverTopup: 2_000_000n }),
    );
    expect(stateFromData((await vault.stateInput()).datum).accruedFees).toBe(0n);
    await vault.submit(
      "top-up",
      buildTopUpReservePlan({ ...(await vault.syncContext()), additionalLovelace: 1_000_000n }),
    );
    expect(stateFromData((await vault.stateInput()).datum).storageLovelace).toBe(11_000_000n);

    for (const pauseFlags of [1n, 0n]) {
      await vault.submit(
        `pause-${pauseFlags}`,
        buildSetPausePlan({ ...(await vault.syncContext()), pauseFlags }),
      );
      expect(stateFromData((await vault.stateInput()).datum).pauseFlags).toBe(pauseFlags);
    }
  });
});

describe.each(["ada", "native"] as const)("CTVS-1 signed %s transactions", (underlying) => {
  it.each(["minimum", "recipient", "pause-authority", "paused-entry"] as const)(
    "rejects %s in the compiled validator",
    async (failure) => {
      const vault = await funded(underlying, `reject-${failure}`);

      if (failure === "pause-authority") {
        const plan = buildSetPausePlan({ ...(await vault.syncContext()), pauseFlags: 1n });

        plan.requiredSigners = [];
        await vault.reject(failure, plan);

        return;
      }

      let context = await vault.syncContext();
      let plan = buildDirectPlan({
        ...context,
        operation: "deposit",
        amount: 1_010_000n,
        bound: 1_000_000n,
        receiver: vault.receiver,
        receiverTopup: 2_000_000n,
      });

      if (failure === "minimum") {
        only(plan.inputs, "one State input").redeemer = directRedeemer("deposit", {
          receiver: vault.receiver,
          amount: 1_010_000n,
          bound: 1_000_001n,
          stateOutput: 0n,
          receiverOutput: 1n,
        });
      } else if (failure === "recipient") {
        const receiver = plan.outputs[1];
        const alternate = getAddressDetails(vault.publisher.address).paymentCredential;

        expect(receiver).toBeDefined();
        expect(alternate).toBeDefined();

        if (!receiver || !alternate) throw new Error("Missing fixture recipient");

        receiver.address = enterprise(alternate.hash, "key");
      } else {
        await vault.submit("pause", buildSetPausePlan({ ...context, pauseFlags: 1n }));
        context = await vault.syncContext();
        expect(() =>
          buildDirectPlan({
            ...context,
            operation: "deposit",
            amount: 1_010_000n,
            bound: 1_000_000n,
            receiver: vault.receiver,
          }),
        ).toThrow("paused");

        // Deliberately construct a candidate outside the SDK's guard to execute the onchain check.
        const state = stateFromData(context.stateInput.datum);
        const { stateData } = await import("@ctvs/protocol");

        plan = buildDirectPlan({
          ...context,
          stateInput: { ...context.stateInput, datum: stateData({ ...state, pauseFlags: 0n }) },
          operation: "deposit",
          amount: 1_010_000n,
          bound: 1_000_000n,
          receiver: vault.receiver,
          receiverTopup: 2_000_000n,
        });
      }

      await vault.reject(failure, plan);
    },
  );
});
