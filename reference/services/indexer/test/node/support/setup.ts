/** Shared disposable recovery setup; family programs and native asset identity remain explicit. */
import { buildGenesisPlan as genesis1 } from "@ctvs/ctvs1";
import { buildGenesisPlan as genesis2 } from "@ctvs/ctvs2";
import { createIndexerClient } from "@ctvs/integration/client";
import { asRef } from "../../../../../testing/ledger/serialization.js";
import { type environment, eventually, queryUrl } from "./environment.js";
import { execute, type Flow, synced } from "./flow.js";
import { install, type Underlying } from "./install.js";
import { wallet } from "./wallet.js";

export async function recoverySetup(
  env: ReturnType<typeof environment>,
  underlying: Underlying,
): Promise<Flow> {
  env.compose("up", "-d", "--no-build", "indexer");
  await eventually(
    async () =>
      (await fetch(`${queryUrl}/health/ready`).catch(() => null))?.ok ? true : undefined,
    "reader readiness",
  );

  const w = await wallet(env);
  const installed = await install(env, w, underlying);
  const { deployment, terms, seed } = installed;
  const vault = createIndexerClient({
    baseUrl: queryUrl,
    expectedNetwork: env.config.network,
  }).vault(deployment.policy);
  const f: Flow = { env, w, installed, vault, receipts: [...installed.receipts] };
  const options = { terms, seed: asRef(seed), configReserve: 10000000n, stateReserve: 10000000n };

  await execute(
    f,
    "genesis",
    deployment.family === "ctvs1"
      ? genesis1({ ...options, deployment })
      : genesis2({ ...options, deployment }),
  );
  await synced(
    () => vault.snapshot(),
    () => true,
    "authenticated genesis",
  );

  return f;
}
