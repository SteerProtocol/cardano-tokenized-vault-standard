/** Exercises wallet approval before signing, independently of whether an added payment could balance. */
import { buildDirectPlan } from "@ctvs/ctvs1";
import { describe, expect, it } from "vitest";
import { createVault } from "../../fixtures/vault.js";
import { constructPlan } from "../../ledger/builder.js";

describe("CTVS-1 complete wallet authorization", () => {
  it("rejects an appended 50 ADA payment before signing or spending and accepts the original plan", async () => {
    const vault = await createVault("ctvs1", "ada", "wallet-effects");
    const plan = buildDirectPlan({
      ...(await vault.syncContext()),
      operation: "deposit",
      amount: 101_000_000n,
      bound: 100_000_000n,
      receiver: vault.receiver,
      receiverTopup: 2_000_000n,
    });
    const authorization = await vault.authorize(plan);
    const before = await vault.stateInput();
    const acceptedBefore = vault.recorder.accepted.length;
    const foreignBefore = await vault.emulator.getUtxos(vault.publisher.address);
    const builder = await constructPlan(vault.lucid, vault.emulator, vault.scripts, plan);

    await expect(
      vault.recorder.submit(
        "unapproved-wallet-payment",
        builder.pay.ToAddress(vault.publisher.address, { lovelace: 50_000_000n }),
        { plan, authorization },
      ),
    ).rejects.toThrow(/unapproved output/);
    expect(vault.recorder.accepted).toHaveLength(acceptedBefore);
    expect(
      vault.recorder.evaluator.records.some(
        (record) => record.stage === "unapproved-wallet-payment" && record.phase === "signed",
      ),
    ).toBe(false);
    expect(await vault.stateInput()).toEqual(before);
    expect(await vault.emulator.getUtxos(vault.publisher.address)).toEqual(foreignBefore);
    await vault.submit("authorized-deposit", plan);
    expect(vault.recorder.accepted).toHaveLength(acceptedBefore + 1);
  });
});
