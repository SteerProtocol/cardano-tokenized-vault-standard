/** Shared fee, authority and purpose guards run for each family and underlying asset. */
import type { ReadQueries } from "@ctvs/integration/query";
import { enterprise } from "@ctvs/protocol";
import type { Flow, peer } from "../../support/flow.js";
import { acceptControl, feePlan, pausePlan } from "./rejection-control.js";
import { output } from "./rejection-mutations.js";
import { rejectVariants } from "./rejection-runner.js";

export type Actor = Awaited<ReturnType<typeof peer>>;

export async function commonRejections(
  f: Flow,
  requested: ReadQueries,
  actor: Actor,
  withdrawal: string,
) {
  const pause = await pausePlan(f, 3n);
  const authority = await rejectVariants(f, requested, pause, [
    {
      label: "missing-pause-authority",
      mutate: (plan) => {
        plan.requiredSigners = [];
      },
    },
    { label: "missing-pause-witness", select: actor.select, phase1: 3101, mutate: () => {} },
    { label: "forbidden-zero-withdrawal", withdrawal, mutate: () => {} },
  ]);
  const fees = await feePlan(f);
  const destination = await rejectVariants(f, requested, fees, [
    {
      label: "redirected-fees",
      mutate: (plan) => {
        output(plan, 1).address = enterprise(actor.hash, "key");
      },
    },
  ]);

  await acceptControl(f, requested, "accepted-fee-control", fees);

  return [...authority.rejected, ...destination.rejected];
}
