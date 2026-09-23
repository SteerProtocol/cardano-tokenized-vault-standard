import { writeFileSync } from "node:fs";
import { buildBatchPlan } from "../../../../reference/implementations/ctvs2/client/src/batch.js";
import { buildDeliverPlan } from "../../../../reference/implementations/ctvs2/client/src/delivery.js";
import { buildRequestPlan } from "../../../../reference/implementations/ctvs2/client/src/requests.js";
import type { Request } from "../../../../reference/packages/protocol/src/types.js";
import { enterprise } from "../../../../reference/packages/protocol/src/wire/primitives.js";
import { createVault } from "../../../../reference/testing/fixtures/vault.js";

// Local emulator only. Run from reference with node --import tsx and this file.
const results: unknown[] = [];
const save = () => writeFileSync(new URL("../evidence/delivery-capacity.json", import.meta.url), JSON.stringify({
  scope: "Local signed Claim delivery; no node or public-network acceptance", results,
}, (_, v) => typeof v === "bigint" ? v.toString() : v, 2) + "\n");

async function run(size: number, recipient: "key" | "script512") {
  const scenario = `review-delivery-${size}-${recipient}`;
  const vault = await createVault("ctvs2", "native", scenario);
  const deadline = BigInt(vault.emulator.now() + 86_400_000);
  const requests = [], claims = [];
  for (let index = 0; index < size; index++) {
    const request: Request = {
      recovery: { vaultPolicy: vault.policy, controller: vault.userKey, refund: vault.receiver, deadlinePosixMs: deadline },
      body: { termsHash: vault.deployment.termsHash, kind: "deposit", offered: 1_010_000n,
        minimumOutput: 1_000_000n, receiver: recipient === "key" ? vault.receiver : {
          address: enterprise("ef".repeat(28)), datum: new Uint8Array(512),
        }, storageLovelace: 5_000_000n, executionBudget: 2_000_000n, settlerFee: 100_000n },
    };
    const id = await vault.submit(`request-${index}`, buildRequestPlan({ ...(await vault.asyncContext()), request }));
    requests.push({ input: await vault.protectedInput(await vault.output(id)) });
  }
  for (let offset = 0; offset < size; offset += 4) {
    const selected = requests.slice(offset, offset + 4);
    const plan = buildBatchPlan({ ...(await vault.asyncContext()), requests: selected, rewardKey: vault.userKey,
      rewardTopup: 2_000_000n, validity: { lowerPosixMs: BigInt(vault.emulator.now()), upperPosixMs: deadline } });
    const id = await vault.submit(`settle-${offset}`, plan);
    for (let index = 0; index < selected.length; index++) claims.push(await vault.protectedInput(await vault.output(id, index + 1)));
  }
  const context = await vault.asyncContext();
  const plan = buildDeliverPlan({ deployment: context.deployment, claims });
  const base = { size, underlying: "native-share-claims", recipient, blueprintSha256: vault.deployment.buildId,
    artifactDirectory: `reference/artifacts/integration/ctvs2/native/${scenario}` };
  try {
    await vault.submit("review-delivery", plan);
    const tx = vault.recorder.accepted.find(x => x.stage === "review-delivery");
    const ev = vault.recorder.evaluator.records.find(x => x.stage === "review-delivery" && x.phase === "signed" && x.accepted);
    const measuredExecutionUnits = ev?.redeemers?.reduce((sum, item) => ({ memory: sum.memory + BigInt(item.ex_units.mem), steps: sum.steps + BigInt(item.ex_units.steps) }), { memory: 0n, steps: 0n });
    const result = { ...base, accepted: true, bytes: tx?.bytes, fee: tx?.fee, measuredExecutionUnits };
    results.push(result); console.log(JSON.stringify(result, (_, v) => typeof v === "bigint" ? v.toString() : v));
  } catch (error) {
    vault.recorder.finish();
    const result = { ...base, accepted: false, error: String(error), evaluations: vault.recorder.evaluator.records.filter(x => x.stage === "review-delivery") };
    results.push(result); console.log(JSON.stringify({ ...base, accepted: false, error: String(error) }));
  }
  save();
}
async function main() {
  for (const recipient of ["key", "script512"] as const) for (const size of [1, 4, 5, 6, 7, 8, 16]) await run(size, recipient);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
