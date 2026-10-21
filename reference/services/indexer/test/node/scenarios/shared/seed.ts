/** Seed identical accounting through each family's supported accepted economic flow. */
import { buildDirectPlan } from "@ctvs/ctvs1";
import { toPlannerContext } from "@ctvs/integration";
import { execute, type Flow, type peer, synced } from "../../support/flow.js";
import { lifecycle } from "../async/async-lifecycle.js";

export async function maintenanceSeed(f: Flow, actor: Awaited<ReturnType<typeof peer>>) {
  if (f.installed.deployment.family === "ctvs2") {
    const deposited = await lifecycle(f, actor, "deposit");

    return { request: deposited.data.request.ref, claim: deposited.data.claim.ref };
  }

  await execute(
    f,
    "bootstrap-deposit",
    buildDirectPlan({
      ...toPlannerContext((await f.vault.context()).data, "ctvs1"),
      operation: "deposit",
      amount: 101000000n,
      bound: 100000000n,
      receiver: f.installed.receiver,
      receiverTopup: 2000000n,
    }),
  );
  await synced(
    () => f.vault.snapshot(),
    (value) => value.data.state.sequence === 1n,
    "seeded maintenance State",
  );

  return undefined;
}
