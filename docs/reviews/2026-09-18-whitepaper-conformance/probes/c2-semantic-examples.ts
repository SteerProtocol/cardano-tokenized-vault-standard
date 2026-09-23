import assert from 'node:assert/strict';
import { buildBatchPlan, buildRequestPlan } from '../../../../reference/implementations/ctvs2/client/src/index.ts';
import { fixture, makeRequest, key } from '../../../../reference/packages/planning/test/fixtures.ts';
import { claimFromData, preview } from '../../../../reference/packages/protocol/src/index.ts';

const results: { name: string; observation: string }[] = [];
const f = fixture('ctvs2', { state: { sequence: 7n, storageLovelace: 4_000_000n } });
const common = { storageLovelace: 2_000_000n, executionBudget: 1_000_000n, settlerFee: 1_000_000n };
const rows = [
  makeRequest(f, { ...common, kind: 'deposit', offered: 101_000n, minimumOutput: 99_900n }, { txId: 'aa'.repeat(32), index: 0n }),
  makeRequest(f, { ...common, kind: 'deposit', offered: 50_500n, minimumOutput: 49_900n }, { txId: 'bb'.repeat(32), index: 0n }),
  makeRequest(f, { ...common, kind: 'redeem', offered: 50_500n, minimumOutput: 49_900n }, { txId: 'cc'.repeat(32), index: 0n }),
];
const plan = buildBatchPlan({ ...f, requests: rows, rewardKey: key, validity: { lowerPosixMs: 1n, upperPosixMs: 2n } });
assert.equal(plan.successor.backingAssets, 1_099_500n);
assert.equal(plan.successor.economicSupply, 1_099_500n);
assert.equal(plan.successor.accruedFees, 2_000n);
assert.equal(plan.successor.sequence, 8n);
assert.equal(plan.economicEffects.shareDelta, 99_500n);
assert.equal(plan.economicEffects.settlerReward, 3_000_000n);
const claims = plan.outputs.filter(o => o.role === 'claim').map(o => claimFromData(o.datum!));
assert.deepEqual(claims.map(c => c.economicQuantity), [100_000n, 50_000n, 50_000n]);
assert.deepEqual(claims.map(c => c.carriedLovelace), [2_000_000n, 2_000_000n, 2_000_000n]);
results.push({ name: 'section 9 mixed snapshot example', observation: 'Exact paper State, net mint, three claim quantities, carried reserves and reward reproduced by public SDK. This is not a balanced signed ledger transaction.' });

const base = fixture('ctvs2', { terms: { virtualShares: 2n, entryBps: 0n, exitBps: 0n }, state: { backingAssets: 2n, economicSupply: 3n } });
function history(order: ('deposit' | 'redeem')[]) {
  let state = { ...base.state };
  let assetClaim = 0n;
  for (const kind of order) {
    const q = preview(kind, kind === 'deposit' ? 1n : 3n, state, base.terms);
    state = { ...state, backingAssets: state.backingAssets + (kind === 'deposit' ? q.netAssets : -q.grossAssets), economicSupply: state.economicSupply + (kind === 'deposit' ? q.shares : -q.shares) };
    if (kind === 'redeem') assetClaim = q.netAssets;
  }
  return [state.backingAssets, state.economicSupply, assetClaim];
}
assert.deepEqual(history(['deposit', 'redeem']), [1n, 1n, 2n]);
assert.deepEqual(history(['redeem', 'deposit']), [2n, 1n, 1n]);
results.push({ name: 'section 3.5 economic histories', observation: 'The distinct paper histories reproduce distinct final backing and asset claims. The example starting state is supplied, not proved reachable from this async-only genesis.' });

let checked = 0;
for (const pauseFlags of [0n, 1n, 2n, 3n]) {
  for (const kind of ['deposit', 'redeem'] as const) {
    const p = fixture('ctvs2', { state: { pauseFlags } });
    const row = makeRequest(p, { kind, offered: 1000n, minimumOutput: 1n });
    const opts = { ...p, requests: [row], rewardKey: key, validity: { lowerPosixMs: 1n, upperPosixMs: 2n } };
    const blocked = (pauseFlags & (kind === 'deposit' ? 1n : 2n)) !== 0n;
    if (blocked) assert.throws(() => buildBatchPlan(opts), /paused/);
    else assert.doesNotThrow(() => buildBatchPlan(opts));
    assert.doesNotThrow(() => buildRequestPlan({ ...p, request: row.request }));
    checked++;
  }
}
results.push({ name: 'section 8.3 SDK directional pause matrix', observation: `${checked} direction/pause combinations matched; candidate creation remained available. Contract pause-matrix execution is not established by this SDK probe.` });
console.log(JSON.stringify({ scope: 'read-only arithmetic and public-planner probes', results }, null, 2));
