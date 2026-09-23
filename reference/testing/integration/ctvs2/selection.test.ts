/** Measures complete signed candidates to test batch sizing, fresh pricing State and independent Claim delivery. */
import { selectNextBatch, selectNextDelivery } from "@ctvs/cardano";
import { type BatchRequest, buildBatchPlan, buildDeliverPlan, buildRequestPlan } from "@ctvs/ctvs2";
import { type ProtectedInput, resolveState } from "@ctvs/planning";
import { claimData, type Request, refId } from "@ctvs/protocol";
import { expect, it } from "vitest";
import { settleRequest } from "../../../implementations/ctvs2/client/src/settlement.js";
import { createVault, type VaultFixture } from "../../fixtures/vault.js";
import { prepareSelectionCandidate } from "../../ledger/selection.js";

interface SelectionScenario {
  vault: VaultFixture;
  deadline: bigint;
  attempt: number;
}

async function fundSelectionRequests(
  vault: VaultFixture,
  deadline: bigint,
): Promise<BatchRequest[]> {
  const pending: BatchRequest[] = [];

  for (let index = 0; index < 8; index++) {
    const request: Request = {
      recovery: {
        vaultPolicy: vault.policy,
        controller: vault.userKey,
        refund: vault.receiver,
        deadlinePosixMs: deadline,
      },
      body: {
        termsHash: vault.deployment.termsHash,
        kind: "deposit",
        offered: 1_010_000n,
        minimumOutput: 1_000_000n,
        receiver: vault.receiver,
        storageLovelace: 5_000_000n,
        executionBudget: 2_000_000n,
        settlerFee: 100_000n,
      },
    };
    const id = await vault.submit(
      `request-${index}`,
      buildRequestPlan({ ...(await vault.asyncContext()), request }),
    );

    pending.push({ input: await vault.protectedInput(await vault.output(id)) });
  }

  return pending;
}

async function rejectUnderfundedReward(
  vault: VaultFixture,
  first: BatchRequest | undefined,
  deadline: bigint,
): Promise<void> {
  const initialContext = await vault.asyncContext();

  if (!first) throw new Error("Missing funded Request");

  // A balancer's minimum-ADA increase is an intent change, never a resource retry.
  await expect(
    prepareSelectionCandidate(
      vault,
      "underfunded-reward",
      buildBatchPlan({
        ...initialContext,
        requests: [first],
        rewardKey: vault.userKey,
        validity: { lowerPosixMs: BigInt(vault.emulator.now()), upperPosixMs: deadline },
      }),
    ),
  ).rejects.toThrow(/value changed.*replan/);
  expect(
    vault.recorder.evaluator.records.some(
      (record) => record.stage === "underfunded-reward" && record.phase === "signed",
    ),
  ).toBe(false);
}

async function selectBatchCandidate(scenario: SelectionScenario, pending: BatchRequest[]) {
  const { vault, deadline } = scenario;
  const validity = { lowerPosixMs: BigInt(vault.emulator.now()), upperPosixMs: deadline };

  return selectNextBatch({
    groups: pending.map((item) => ({ items: [item] })),
    ref: (item) => item.input.ref,
    readSnapshot: async () => {
      const context = await vault.asyncContext();

      return { context, stateRef: context.stateInput.ref, maxBatch: context.terms.maxBatch };
    },
    validateAll: (items, snapshot) => {
      const context = snapshot.context;
      const state = resolveState(context, "ctvs2");

      for (const item of items) {
        claimData(
          settleRequest(
            item,
            context.deployment,
            state,
            context.stateInput,
            context.terms,
            validity.upperPosixMs,
          ).claim,
        );
      }
    },
    prepare: (items, snapshot) =>
      prepareSelectionCandidate(
        vault,
        `batch-candidate-${scenario.attempt++}`,
        buildBatchPlan({
          ...snapshot.context,
          requests: [...items],
          rewardKey: vault.userKey,
          rewardTopup: 2_000_000n,
          validity,
        }),
      ),
  });
}

async function settleSelectedBatches(scenario: SelectionScenario, pending: BatchRequest[]) {
  const { vault } = scenario;
  const claims: ProtectedInput[] = [];
  const pricingStates: string[] = [];
  const batchSizes: number[] = [];

  while (pending.length > 0) {
    const selected = await selectBatchCandidate(scenario, pending);

    expect(selected.prepared).not.toBeNull();

    if (!selected.prepared) throw new Error("No feasible batch");

    expect(selected.included.length).toBeLessThanOrEqual(Number(vault.terms.maxBatch));

    if (batchSizes.length === 0) {
      expect(selected.included.length).toBeLessThan(pending.length);
      expect(selected.attempts[0]).toMatchObject({ outcome: "resource-limit", resource: "memory" });
      expect(selected.excluded.every((item) => item.reason === "needs-separate-group")).toBe(true);
    }

    expect(selected.prepared.plan.pricingBasis).toEqual(selected.pricingBasis);
    pricingStates.push(refId(selected.pricingBasis));
    batchSizes.push(selected.included.length);

    const plan = selected.prepared.plan;

    vault.recorder.write(`selection-batch-${batchSizes.length}`, {
      pricingBasis: selected.pricingBasis,
      included: selected.includedRefs,
      excluded: selected.excluded,
      attempts: selected.attempts,
    });

    // Submission reconstructs and evaluates again, through the normal effects verifier.
    const id = await vault.submit(`selected-batch-${batchSizes.length}`, plan);

    for (let index = 0; index < plan.outputs.length; index++) {
      if (plan.outputs[index]?.role === "claim")
        claims.push(await vault.protectedInput(await vault.output(id, index)));
    }

    const included = new Set(selected.includedRefs.map(refId));

    pending = pending.filter((item) => !included.has(refId(item.input.ref)));
  }

  return { claims, pricingStates, batchSizes };
}

async function deliverSelectedClaims(scenario: SelectionScenario, claims: ProtectedInput[]) {
  const { vault } = scenario;
  const context = await vault.asyncContext();
  const beforeDelivery = await vault.stateInput();
  let remaining = claims;
  const deliverySizes: number[] = [];

  while (remaining.length > 0) {
    const selected = await selectNextDelivery({
      groups: remaining.map((item) => ({ items: [item] })),
      ref: (item) => item.ref,
      validateAll: (items) => {
        for (const item of items)
          buildDeliverPlan({ deployment: context.deployment, claims: [item] });
      },
      prepare: (items) =>
        prepareSelectionCandidate(
          vault,
          `delivery-candidate-${scenario.attempt++}`,
          buildDeliverPlan({ deployment: context.deployment, claims: [...items] }),
        ),
    });

    expect(selected.prepared).not.toBeNull();

    if (!selected.prepared) throw new Error("No feasible delivery");

    if (deliverySizes.length === 0) {
      expect(selected.included.length).toBeLessThan(remaining.length);
      expect(selected.attempts[0]?.outcome).toBe("resource-limit");
    }

    const plan = selected.prepared.plan;

    expect(plan.inputs.every((input) => input.role === "claim")).toBe(true);
    expect(plan.referenceInputs).toEqual([]);
    expect(plan.mint).toEqual([]);
    deliverySizes.push(selected.included.length);
    vault.recorder.write(`selection-delivery-${deliverySizes.length}`, {
      included: selected.includedRefs,
      excluded: selected.excluded,
      attempts: selected.attempts,
    });
    await vault.submit(`selected-delivery-${deliverySizes.length}`, plan);

    const included = new Set(selected.includedRefs.map(refId));

    remaining = remaining.filter((item) => !included.has(refId(item.ref)));
  }

  return { beforeDelivery, deliverySizes };
}

it("selects signed feasible batches from real budgets, refreshes State, and independently splits Claim delivery", async () => {
  const vault = await createVault("ctvs2", "native", "resource-aware-selection");
  const deadline = BigInt(vault.emulator.now() + 86_400_000);
  const pending = await fundSelectionRequests(vault, deadline);

  await rejectUnderfundedReward(vault, pending[0], deadline);

  const scenario = { vault, deadline, attempt: 0 };
  const { claims, pricingStates, batchSizes } = await settleSelectedBatches(scenario, pending);

  expect(claims).toHaveLength(8);
  expect(new Set(pricingStates).size).toBe(batchSizes.length);
  expect(batchSizes.reduce((total, size) => total + size, 0)).toBe(8);

  const { beforeDelivery, deliverySizes } = await deliverSelectedClaims(scenario, claims);

  expect(deliverySizes.reduce((total, size) => total + size, 0)).toBe(8);
  expect(await vault.stateInput()).toEqual(beforeDelivery);
  expect(
    vault.recorder.evaluator.records.some(
      (record) =>
        record.stage.startsWith("batch-candidate-") && record.phase === "signed" && record.accepted,
    ),
  ).toBe(true);
  expect(
    vault.recorder.evaluator.records.some(
      (record) =>
        record.stage.startsWith("delivery-candidate-") &&
        record.phase === "signed" &&
        record.accepted,
    ),
  ).toBe(true);
});
