import assert from 'node:assert/strict';
import { buildBatchPlan, buildDeliverPlan, buildRefundPlan } from '../../../../reference/implementations/ctvs2/client/src/index.ts';
import { fixture, source, requestRef, stateRef, destination } from '../../../../reference/packages/planning/test/fixtures.ts';
import { claimData, credentialData, encodeData, hex } from '../../../../reference/packages/protocol/src/index.ts';
import { claimValue } from '../../../../reference/packages/planning/src/index.ts';

// Read-only review probes: no chain operations, source edits, or generated compiler staging.
const results: { name: string; observation: string }[] = [];
const authorizedKey = 'ab'.repeat(28);
const f = fixture('ctvs2', { terms: { settlers: [authorizedKey] } });
const batchArgs = {
  ...f,
  requests: [{ input: f.requestInput }],
  validity: { lowerPosixMs: 1n, upperPosixMs: 2n },
};
assert.equal(
  hex(encodeData(credentialData({ type: 'key', hash: authorizedKey }))),
  hex(encodeData(credentialData({ type: 'key', hash: authorizedKey.toUpperCase() }))),
);
assert.equal(buildBatchPlan({ ...batchArgs, rewardKey: authorizedKey }).requiredSigners[0], authorizedKey);
assert.throws(() => buildBatchPlan({ ...batchArgs, rewardKey: authorizedKey.toUpperCase() }), /unauthorized settler/);
results.push({ name: 'settler hex normalization', observation: 'Identical credential bytes are accepted in lowercase but rejected as unauthorized when rewardKey is uppercase.' });

const claim = {
  vaultPolicy: f.deployment.policy,
  requestRef,
  stateRef,
  termsHash: f.state.termsHash,
  asset: f.terms.underlying,
  economicQuantity: 10n,
  receiver: destination,
  carriedLovelace: 2_000_000n,
};
const enterpriseClaim = source(requestRef, claimData(claim), claimValue(claim), f.deployment.claimScript);
assert.equal(buildDeliverPlan({ deployment: f.deployment, claims: [enterpriseClaim] }).outputs.length, 1);
assert.throws(() => buildDeliverPlan({
  deployment: f.deployment,
  claims: [{ ...enterpriseClaim, address: { ...enterpriseClaim.address, stake: { type: 'key', hash: authorizedKey } } }],
}), /wrong protected input address/);
results.push({ name: 'same Q with staking credential', observation: 'SDK accepts enterprise Q input but rejects the same Q payment script with a staking credential. Onchain acceptance is established by source review, not this TypeScript probe.' });

const refund = buildRefundPlan({ deployment: f.deployment, source: f.requestInput, mode: 'cancel', validity: { lowerPosixMs: 1n, upperPosixMs: 2n } });
assert.deepEqual(refund.outputs[0]?.value, f.requestInput.value);
assert.deepEqual(buildDeliverPlan({ deployment: f.deployment, claims: [enterpriseClaim] }).outputs[0]?.value, enterpriseClaim.value);
results.push({ name: 'recovery and delivery top-up surface', observation: 'Default protected outputs preserve exactly input value. Public option types expose no receiver top-up argument; larger outputs require caller-authored plan changes.' });
console.log(JSON.stringify({ scope: 'read-only SDK boundary probes', results }, null, 2));
