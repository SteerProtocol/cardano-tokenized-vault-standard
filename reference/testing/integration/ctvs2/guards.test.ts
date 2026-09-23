/** Mutates valid plans to prove the compiled validators enforce recipient, signer and Claim-coverage obligations. */
import { buildBatchPlan, buildDeliverPlan } from "@ctvs/ctvs2";
import { claimData, claimFromData, deliverRedeemer, enterprise } from "@ctvs/protocol";
import { getAddressDetails } from "@lucid-evolution/lucid";
import { describe, expect, it } from "vitest";
import { fundRequest } from "../../fixtures/requests.js";
import { createVault } from "../../fixtures/vault.js";

describe.each(["ada", "native"] as const)("CTVS-2 compiled %s guards", (underlying) => {
  it("rejects rewritten Claim recipients and missing settler authorization", async () => {
    const vault = await createVault("ctvs2", underlying, "settlement-guards");
    const { request, utxo } = await fundRequest(vault, "deposit", 101_000_000n, 100_000_000n);
    const context = await vault.asyncContext();
    const options = {
      ...context,
      requests: [{ input: await vault.protectedInput(utxo) }],
      rewardKey: vault.userKey,
      rewardTopup: 2_000_000n,
      validity: {
        lowerPosixMs: BigInt(vault.emulator.now()),
        upperPosixMs: request.recovery.deadlinePosixMs,
      },
    };
    const altered = buildBatchPlan(options),
      claim = altered.outputs[1];
    const alternate = getAddressDetails(vault.publisher.address).paymentCredential;

    if (!claim?.datum || !alternate) throw new Error("Missing fixture Claim");

    claim.datum = claimData({
      ...claimFromData(claim.datum),
      receiver: { address: enterprise(alternate.hash, "key"), datum: null },
    });
    await vault.reject("replaced-claim-recipient", altered);

    const unsigned = buildBatchPlan(options);

    unsigned.requiredSigners = [];
    await vault.reject("missing-settler", unsigned);
    expect((await vault.emulator.getUtxosByOutRef([utxo])).length).toBe(1);
  });

  it("requires all actual Q inputs to agree on one complete delivery list", async () => {
    const vault = await createVault("ctvs2", underlying, "claim-coverage");
    const first = await fundRequest(vault, "deposit", 101_000_000n, 100_000_000n, "-one");
    const second = await fundRequest(vault, "deposit", 101_000_000n, 100_000_000n, "-two");
    const context = await vault.asyncContext();
    const batch = buildBatchPlan({
      ...context,
      requests: [
        { input: await vault.protectedInput(first.utxo) },
        { input: await vault.protectedInput(second.utxo) },
      ],
      rewardKey: vault.userKey,
      rewardTopup: 2_000_000n,
      validity: {
        lowerPosixMs: BigInt(vault.emulator.now()),
        upperPosixMs: first.request.recovery.deadlinePosixMs,
      },
    });
    const txId = await vault.submit("settle-two", batch);
    const claims = await Promise.all([vault.output(txId, 1), vault.output(txId, 2)]);
    const sources = await Promise.all(claims.map((claim) => vault.protectedInput(claim)));
    const delivery = buildDeliverPlan({ deployment: context.deployment, claims: sources });
    const firstInput = delivery.inputs[0];

    if (!firstInput) throw new Error("Missing Claim input");

    const incomplete = deliverRedeemer([{ claimRef: firstInput.ref, receiverOutput: 0n }]);

    for (const input of delivery.inputs) input.redeemer = incomplete;

    await vault.reject("incomplete-claim-coverage", delivery);
    expect((await vault.emulator.getUtxosByOutRef(claims)).length).toBe(2);
    await vault.submit(
      "complete-delivery",
      buildDeliverPlan({ deployment: context.deployment, claims: sources }),
    );
  });
});
