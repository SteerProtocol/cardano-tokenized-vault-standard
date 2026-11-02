/** Independent custody and unit checks supplement complete HTTP/replay parity during recovery. */
import type { QueryResponse } from "@ctvs/integration/query";
import { expect } from "vitest";
import { economicUnits, stateCustody } from "../../support/assets.js";
import { type Flow, readback } from "../../support/flow.js";
import type { economicRead } from "../../support/persistence.js";

export async function recoveryCustody(
  f: Flow,
  response: QueryResponse<ReturnType<typeof economicRead>>,
  label: string,
) {
  const { snapshot, context } = response.data;

  expect(snapshot.state.storageLovelace).toBe(10000000n);
  expect(context.stateInput.value).toEqual(stateCustody(f, snapshot.state));

  for (const method of [
    "convertToAssets",
    "convertToShares",
    "previewDeposit",
    "previewMint",
    "previewWithdraw",
    "previewRedeem",
  ] as const)
    economicUnits(f, response.data[method]);

  await readback(f, `${label}-state`, context.stateInput.ref, context.stateInput);
}
