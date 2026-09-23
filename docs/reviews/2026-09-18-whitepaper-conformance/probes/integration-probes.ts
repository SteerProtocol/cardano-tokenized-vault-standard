import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildDirectPlan } from "../../../../reference/implementations/ctvs1/client/src/direct.js";
import { buildBatchPlan } from "../../../../reference/implementations/ctvs2/client/src/batch.js";
import { buildRequestPlan } from "../../../../reference/implementations/ctvs2/client/src/requests.js";
import type { Request } from "../../../../reference/packages/protocol/src/types.js";
import { enterprise } from "../../../../reference/packages/protocol/src/wire/primitives.js";
import { createVault } from "../../../../reference/testing/fixtures/vault.js";
import { constructPlan } from "../../../../reference/testing/ledger/builder.js";

// Local emulator review experiments, not production or public-network transactions.
// Run from reference/: node --import tsx ../docs/reviews/2026-09-18-whitepaper-conformance/probes/integration-probes.ts
const evidence = resolve("../docs/reviews/2026-09-18-whitepaper-conformance/evidence");
const results: unknown[] = [];
const save = () => writeFileSync(resolve(evidence, "integration-probes.json"), JSON.stringify({
  environment: "Local Lucid Emulator and compiled Plutus evaluator; no cardano-node acceptance",
  recordedAt: new Date().toISOString(), results,
}, (_, value) => typeof value === "bigint" ? value.toString() : value, 2) + "\n");

async function batch(size: number, underlying: "ada" | "native", recipient: "key" | "script512") {
  const name = `review-batch-${size}-${recipient}`;
  const vault = await createVault("ctvs2", underlying, name);
  const deadline = BigInt(vault.emulator.now() + 86_400_000);
  const requests = [];
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
  const plan = buildBatchPlan({ ...(await vault.asyncContext()), requests, rewardKey: vault.userKey,
    rewardTopup: 2_000_000n, validity: { lowerPosixMs: BigInt(vault.emulator.now()), upperPosixMs: deadline } });
  const base = { probe: "batch-resources", size, underlying, recipient, planConstructed: true,
    blueprintSha256: vault.deployment.buildId, artifactDirectory: `reference/artifacts/integration/ctvs2/${underlying}/${name}` };
  try {
    await vault.submit("review-batch", plan);
    const signed = vault.recorder.accepted.find(item => item.stage === "review-batch");
    const measured = vault.recorder.evaluator.records.find(item => item.stage === "review-batch" && item.phase === "signed" && item.accepted);
    const units = measured?.redeemers?.reduce((a, item) => ({ memory: a.memory + BigInt(item.ex_units.mem), steps: a.steps + BigInt(item.ex_units.steps) }), { memory: 0n, steps: 0n });
    const result = { ...base, accepted: true, bytes: signed?.bytes, fee: signed?.fee, measuredExecutionUnits: units };
    results.push(result); console.log(JSON.stringify(result, (_, v) => typeof v === "bigint" ? v.toString() : v));
    save(); return true;
  } catch (error) {
    vault.recorder.finish();
    const result = { ...base, accepted: false, error: String(error), evaluations: vault.recorder.evaluator.records.filter(item => item.stage === "review-batch") };
    results.push(result); console.log(JSON.stringify({ ...base, accepted: false, error: String(error) }));
    save(); return false;
  }
}

async function unplannedOutput() {
  const vault = await createVault("ctvs1", "ada", "review-unplanned-output");
  const plan = buildDirectPlan({ ...(await vault.syncContext()), operation: "deposit", amount: 1_010_000n,
    bound: 1_000_000n, receiver: vault.receiver, receiverTopup: 2_000_000n });
  const builder = (await constructPlan(vault.lucid, vault.emulator, vault.scripts, plan))
    .pay.ToAddress(vault.publisher.address, { lovelace: 50_000_000n });
  const id = await vault.recorder.submit("unplanned-output", builder, plan.outputs);
  const actual = await vault.output(id, plan.outputs.length);
  if (actual.address !== vault.publisher.address || actual.assets.lovelace !== 50_000_000n)
    throw new Error("Unplanned payout was not present at expected output");
  vault.recorder.finish();
  const result = { probe: "unplanned-output", accepted: true, plannedProtectedOutputs: plan.outputs.length,
    additionalRecipient: "separate generated publisher wallet", additionalLovelace: "50000000",
    explanation: "Protected-output checking is narrower than complete user-approved effects checking; not a vault accounting violation.",
    artifactDirectory: "reference/artifacts/integration/ctvs1/ada/review-unplanned-output" };
  results.push(result); console.log(JSON.stringify(result)); save();
}

async function main() {
  await unplannedOutput();
  for (const underlying of ["ada", "native"] as const) {
    for (const recipient of ["key", "script512"] as const) {
      let previous = 0;
      for (const size of [1, 2, 4, 8, 16]) {
        if (!await batch(size, underlying, recipient)) {
          // Refine only the first failing interval; no capacity claim outside these shapes.
          for (let refine = previous + 1; refine < size; refine++) if (!await batch(refine, underlying, recipient)) break;
          break;
        }
        previous = size;
      }
    }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
