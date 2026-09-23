/** Fuzzes planner conservation and separate ADA funding using semantic fixtures, without ledger execution. */
import type { TransactionPlan } from "@ctvs/planning";
import { assetId, NAMES, type Operation, preview, type Quote, stateFromData } from "@ctvs/protocol";
import fc from "fast-check";
import { expect, test } from "vitest";
import {
  destination,
  fixture,
  policy,
  type SyncFixture,
} from "../../../../packages/planning/test/fixtures.js";
import { buildDirectPlan } from "../src/index.js";

function boundForOperation(operation: Operation, quote: Quote): bigint {
  switch (operation) {
    case "deposit":
    case "withdraw":
      return quote.shares;
    case "mint":
      return quote.grossAssets;
    case "redeem":
      return quote.netAssets;
  }
}

interface DirectCase {
  f: SyncFixture;
  plan: TransactionPlan;
  quote: Quote;
  entry: boolean;
  receiverTopup: bigint;
  ada: boolean;
}

// Keep the expected custody equations explicit instead of reusing the production transition result.
function assertStateAccounting({ f, plan, quote, entry }: DirectCase): void {
  const stateOutput = plan.outputs.at(0);

  expect(stateOutput?.datum).not.toBeNull();

  if (!stateOutput?.datum) throw new Error("direct outputs missing");

  const successor = stateFromData(stateOutput.datum);

  expect(successor.economicSupply - f.state.economicSupply).toBe(
    entry ? quote.shares : -quote.shares,
  );
  expect(successor.accruedFees - f.state.accruedFees).toBe(quote.fee);
  expect(successor.backingAssets - f.state.backingAssets).toBe(
    entry ? quote.netAssets : -quote.grossAssets,
  );
  expect(plan.mint.at(0)?.assets[NAMES.share]).toBe(
    successor.economicSupply - f.state.economicSupply,
  );

  const unit = assetId(f.terms.underlying);
  const underlyingDelta = (stateOutput.value[unit] ?? 0n) - (f.stateInput.value[unit] ?? 0n);

  expect(underlyingDelta).toBe(entry ? quote.grossAssets : -quote.netAssets);
}

function assertReceiverPayment({ f, plan, quote, entry, receiverTopup, ada }: DirectCase): void {
  const receiver = plan.outputs.at(1);

  if (!receiver) throw new Error("direct outputs missing");

  const economicUnit = entry ? `${policy}.${NAMES.share}` : assetId(f.terms.underlying);

  expect(receiver.value[economicUnit]).toBe(
    (entry ? quote.shares : quote.netAssets) + (economicUnit === "ada" ? receiverTopup : 0n),
  );
  expect(receiver.value.ada ?? 0n).toBe(receiverTopup + (!entry && ada ? quote.netAssets : 0n));
}

test("direct operations conserve underlying liabilities, supply and separately funded ADA", () => {
  fc.assert(
    fc.property(
      fc.constantFrom("deposit", "mint", "withdraw", "redeem"),
      fc.bigInt({ min: 100n, max: 100_000n }),
      fc.bigInt({ min: 0n, max: 500n }),
      fc.bigInt({ min: 0n, max: 5_000_000n }),
      fc.boolean(),
      (operation, amount, bps, receiverTopup, ada) => {
        const f = fixture("ctvs1", {
          terms: { entryBps: bps, exitBps: bps, ...(ada ? { underlying: "ada" as const } : {}) },
        });
        const quote = preview(operation, amount, f.state, f.terms);
        const plan = buildDirectPlan({
          ...f,
          operation,
          amount,
          bound: boundForOperation(operation, quote),
          receiver: destination,
          receiverTopup,
        });
        const scenario = {
          f,
          plan,
          quote,
          entry: operation === "deposit" || operation === "mint",
          receiverTopup,
          ada,
        };

        assertStateAccounting(scenario);
        assertReceiverPayment(scenario);
      },
    ),
    { numRuns: 300 },
  );
});
