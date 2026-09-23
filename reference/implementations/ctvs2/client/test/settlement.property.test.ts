/** Fuzzes deterministic batch allocation and full-value delivery on synthetic Requests and Claims. */
import { claimValue, planToJson } from "@ctvs/planning";
import { claimFromData, equalData, preview, refId } from "@ctvs/protocol";
import fc from "fast-check";
import { expect, test } from "vitest";
import { fixture, key, makeRequest, source } from "../../../../packages/planning/test/fixtures.js";
import { buildBatchPlan, buildDeliverPlan } from "../src/index.js";

test("batch permutations keep one snapshot and allocate every request exactly once", () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          kind: fc.constantFrom("deposit", "redeem"),
          offered: fc.bigInt({ min: 100n, max: 10_000n }),
          claimTopup: fc.bigInt({ min: 0n, max: 2_000_000n }),
          fee: fc.bigInt({ min: 0n, max: 300_000n }),
        }),
        { minLength: 1, maxLength: 8 },
      ),
      fc.boolean(),
      (rows, ada) => {
        const f = fixture("ctvs2", { terms: ada ? { underlying: "ada" } : {} });
        const requests = rows.map((row, index) => ({
          input: makeRequest(
            f,
            { kind: row.kind, offered: row.offered, minimumOutput: 1n, settlerFee: row.fee },
            { txId: index.toString(16).padStart(64, "0"), index: 0n },
          ).input,
          claimTopup: row.claimTopup,
        }));
        const args = {
          ...f,
          requests,
          rewardKey: key,
          validity: { lowerPosixMs: 1n, upperPosixMs: 2_000_000n },
        };
        const plan = buildBatchPlan(args);

        expect(planToJson(buildBatchPlan({ ...args, requests: [...requests].reverse() }))).toEqual(
          planToJson(plan),
        );

        let backingDelta = 0n,
          shareDelta = 0n,
          feeDelta = 0n,
          settlerReward = 0n;

        // Each expectation uses the original snapshot, including mixed deposit/redemption batches.
        for (const [index, row] of rows.entries()) {
          const quote = preview(row.kind, row.offered, f.state, f.terms),
            entry = row.kind === "deposit";

          backingDelta += entry ? quote.netAssets : -quote.grossAssets;
          shareDelta += entry ? quote.shares : -quote.shares;
          feeDelta += quote.fee;
          settlerReward += row.fee;

          const allocated = plan.outputs.at(index + 1),
            request = requests.at(index);

          if (!allocated?.datum || !request) throw new Error("missing claim allocation");

          const claim = claimFromData(allocated.datum);

          expect(refId(claim.requestRef)).toBe(refId(request.input.ref));
          expect(claim.stateRef).toEqual(f.stateInput.ref);
          expect(claim.economicQuantity).toBe(entry ? quote.shares : quote.netAssets);
          expect(claim.carriedLovelace).toBe(2_300_000n - row.fee + row.claimTopup);
          expect(allocated.value).toEqual(claimValue(claim));
        }

        expect(plan.economicEffects).toMatchObject({
          backingDelta,
          shareDelta,
          feeDelta,
          settlerReward,
        });
        expect(plan.successor.backingAssets).toBe(f.state.backingAssets + backingDelta);
        expect(plan.inputs).toHaveLength(rows.length + 1);
        expect(plan.outputs.filter((output) => output.role === "claim")).toHaveLength(rows.length);
      },
    ),
    { numRuns: 150 },
  );
});

test("delivery keeps exhaustive common coverage and preserves independently funded surplus", () => {
  fc.assert(
    fc.property(
      fc.array(fc.bigInt({ min: 1n, max: 1_000_000n }), { minLength: 1, maxLength: 8 }),
      (quantities) => {
        const f = fixture("ctvs2");
        const batch = buildBatchPlan({
          ...f,
          requests: [{ input: f.requestInput }],
          rewardKey: key,
          validity: { lowerPosixMs: 1n, upperPosixMs: 2n },
        });
        const claimOutput = batch.outputs.at(1);

        if (!claimOutput?.datum) throw new Error("missing source claim datum");

        const claims = quantities.map((quantity, index) =>
          source(
            { txId: index.toString(16).padStart(64, "0"), index: 0n },
            claimOutput.datum ?? 0n,
            {
              ...claimOutput.value,
              ada: (claimOutput.value.ada ?? 0n) + quantity,
              [`${"ee".repeat(28)}.00`]: quantity,
            },
            f.deployment.claimScript,
          ),
        );
        const delivery = buildDeliverPlan({
          deployment: f.deployment,
          claims: [...claims].reverse(),
        });
        const common = delivery.inputs.at(0)?.redeemer;

        if (!common) throw new Error("missing Deliver envelope");

        for (const [index, claim] of claims.entries()) {
          expect(delivery.outputs.at(index)?.value).toEqual(claim.value);

          const redeemer = delivery.inputs.at(index)?.redeemer;

          if (!redeemer) throw new Error("missing claim redeemer");

          expect(equalData(common, redeemer)).toBe(true);
        }

        expect(delivery.referenceInputs).toEqual([]);
        expect(delivery.requiredSigners).toEqual([]);
      },
    ),
    { numRuns: 100 },
  );
});
