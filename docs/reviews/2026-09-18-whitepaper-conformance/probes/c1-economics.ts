import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { preview, transition, convertToAssets, convertToShares, maxDeposit, Q_MAX } from '../../../../reference/packages/protocol/src/index.ts';
import { state as fixtureState, terms as fixtureTerms } from '../../../../reference/packages/protocol/tests/fixtures/example.ts';
import type { Operation, State, Terms } from '../../../../reference/packages/protocol/src/types.ts';

// Independent oracle transcribes PDF equations using quotient/remainder ceiling.
// Expected transition acceptance does not call production transition or its helpers.
const ceil = (n: bigint, d: bigint) => n / d + (n % d === 0n ? 0n : 1n);
const inQ = (n: bigint) => n >= 0n && n <= Q_MAX;
const ops: Operation[] = ['deposit', 'mint', 'withdraw', 'redeem'];
const counts = { quoteComparisons: 0, transitionComparisons: 0, conversionComparisons: 0, maximumComparisons: 0, largeBoundaryComparisons: 0, adjustedPriceComparisons: 0, roundTripComparisons: 0 };
function oracle(op: Operation, amount: bigint, a: bigint, s: bigint, t: Terms) {
  const x = a + 1n, y = s + t.virtualShares;
  let grossAssets: bigint, netAssets: bigint, shares: bigint, fee: bigint;
  if (op === 'deposit') { grossAssets = amount; fee = ceil(amount * t.entryBps, 10000n + t.entryBps); netAssets = amount - fee; shares = netAssets * y / x; }
  else if (op === 'mint') { shares = amount; netAssets = ceil(amount * x, y); fee = ceil(netAssets * t.entryBps, 10000n); grossAssets = netAssets + fee; }
  else if (op === 'withdraw') { netAssets = amount; fee = ceil(amount * t.exitBps, 10000n); grossAssets = amount + fee; shares = ceil(grossAssets * y, x); }
  else { shares = amount; grossAssets = amount * x / y; fee = ceil(grossAssets * t.exitBps, 10000n + t.exitBps); netAssets = grossAssets - fee; }
  return { grossAssets, netAssets, shares, fee };
}
function check(op: Operation, amount: bigint, state: State, terms: Terms, boundary = false) {
  const expected = oracle(op, amount, state.backingAssets, state.economicSupply, terms);
  if (!Object.values(expected).every(inQ)) { assert.throws(() => preview(op, amount, state, terms)); counts.largeBoundaryComparisons++; return; }
  const quoted = preview(op, amount, state, terms);
  for (const key of ['grossAssets', 'netAssets', 'shares', 'fee'] as const) assert.equal(quoted[key], expected[key], `${op} ${key}`);
  counts.quoteComparisons++;
  if (boundary) counts.largeBoundaryComparisons++;
  const entry = op === 'deposit' || op === 'mint';
  const boundValue = op === 'deposit' ? expected.shares : op === 'mint' ? expected.grossAssets : op === 'withdraw' ? expected.shares : expected.netAssets;
  const next = {
    ...state,
    sequence: state.sequence + 1n,
    backingAssets: state.backingAssets + (entry ? expected.netAssets : -expected.grossAssets),
    economicSupply: state.economicSupply + (entry ? expected.shares : -expected.shares),
    accruedFees: state.accruedFees + expected.fee,
  };
  for (const bound of [boundValue, entry && op === 'deposit' || op === 'redeem' ? boundValue + 1n : boundValue - 1n]) {
    const boundPass = op === 'mint' || op === 'withdraw' ? boundValue <= bound : boundValue >= bound;
    const allowed = amount > 0n && expected.grossAssets > 0n && expected.netAssets > 0n && expected.shares > 0n && bound > 0n && inQ(bound) && boundPass &&
      (terms.executionModes & (entry ? 1n : 2n)) !== 0n && (state.pauseFlags & (entry ? 1n : 2n)) === 0n &&
      [next.sequence, next.backingAssets, next.economicSupply, next.accruedFees].every(inQ) &&
      inQ(next.backingAssets + next.accruedFees + (terms.underlying === 'ada' ? next.storageLovelace : 0n)) &&
      (terms.maxBacking === null || next.backingAssets <= terms.maxBacking);
    if (allowed) {
      const result = transition(op, amount, bound, state, terms);
      assert.deepEqual(result.successor, next);
      assert.equal(result.shareMint, entry ? expected.shares : -expected.shares);
      assert.equal((next.backingAssets + next.accruedFees) - (state.backingAssets + state.accruedFees), entry ? expected.grossAssets : -expected.netAssets);
      // Section 12.3: compare adjusted prices by exact cross multiplication.
      assert.ok((next.backingAssets + 1n) * (state.economicSupply + terms.virtualShares) >= (state.backingAssets + 1n) * (next.economicSupply + terms.virtualShares));
      counts.adjustedPriceComparisons++;
      if (op === 'deposit') {
        const after = preview('redeem', expected.shares, next, terms);
        assert.ok(after.grossAssets <= expected.netAssets);
        assert.ok(after.netAssets <= amount);
        counts.roundTripComparisons++;
      }
    } else assert.throws(() => transition(op, amount, bound, state, terms));
    counts.transitionComparisons++;
  }
}
for (let a = 0n; a <= 11n; a++) for (let s = 0n; s <= 11n; s++) for (const v of [1n, 2n, 7n]) for (const fee of [0n, 1n, 100n, 5000n, 9999n]) {
  const state = { ...fixtureState, backingAssets: a, economicSupply: s, accruedFees: 0n, storageLovelace: 1n, pauseFlags: 0n };
  const terms = { ...fixtureTerms, executionModes: 3n, virtualShares: v, entryBps: fee, exitBps: 9999n - fee, maxBacking: a + 100n };
  for (let n = 0n; n <= 20n; n++) for (const op of ops) check(op, n, state, terms);
}
// The price equation must not change when a valid mode/pause/fee setting changes.
for (const modes of [1n, 2n, 3n, 4n, 8n, 12n, 15n]) for (const pause of [0n, 1n, 2n, 3n]) for (const fee of [0n, 9999n]) {
  const state = { ...fixtureState, backingAssets: 17n, economicSupply: 29n, accruedFees: 3n, storageLovelace: 1n, pauseFlags: pause };
  const terms = { ...fixtureTerms, executionModes: modes, entryBps: fee, exitBps: fee, virtualShares: 3n, maxBacking: 17n };
  for (let n = 0n; n <= 20n; n++) {
    assert.equal(convertToShares(state, terms, n), n * 32n / 18n);
    assert.equal(convertToAssets(state, terms, n), n * 18n / 32n);
    counts.conversionComparisons += 2;
  }
  for (const op of ops) check(op, 10n, state, terms);
}
// Upper-domain boundaries, including physical custody and result overflows.
for (const underlying of ['ada', fixtureTerms.underlying] as const) for (const a of [0n, 1n, Q_MAX / 2n, Q_MAX - 10n]) for (const s of [0n, 1n, Q_MAX / 2n, Q_MAX]) for (const v of [1n, Q_MAX]) for (const fee of [0n, 9999n]) {
  const state = { ...fixtureState, backingAssets: a, economicSupply: s, accruedFees: 0n, storageLovelace: 1n, pauseFlags: 0n };
  const terms = { ...fixtureTerms, underlying, executionModes: 3n, virtualShares: v, entryBps: fee, exitBps: fee, maxBacking: null };
  for (const n of [0n, 1n, 2n, Q_MAX / 2n, Q_MAX]) for (const op of ops) check(op, n, state, terms, true);
}
// Exhaustive small capacity domains, including the non-prefix positive-output trap.
for (const underlying of ['ada', fixtureTerms.underlying] as const) for (let a = 0n; a <= 5n; a++) for (let s = 0n; s <= 5n; s++) for (const v of [1n, 3n]) for (const fee of [0n, 1n, 100n, 9999n]) for (let headroom = 0n; headroom <= 6n; headroom++) {
  const state = { ...fixtureState, backingAssets: a, economicSupply: s, accruedFees: 0n, storageLovelace: 1n, pauseFlags: 0n };
  const terms = { ...fixtureTerms, underlying, executionModes: 3n, virtualShares: v, entryBps: fee, maxBacking: a + headroom };
  let expected = 0n;
  for (let amount = 1n; amount <= 2n * headroom + 2n; amount++) {
    const q = oracle('deposit', amount, a, s, terms);
    if (q.netAssets > 0n && q.shares > 0n && a + q.netAssets <= a + headroom) expected = amount;
  }
  const actual = maxDeposit(state, terms);
  assert.equal(actual.status, 'known');
  if (actual.status === 'known') assert.equal(actual.value, expected);
  counts.maximumComparisons++;
}
const result = { probe: 'C1 independent equation and boundary comparison', recordedAt: new Date().toISOString(), passed: true, counts, scope: 'Pure TypeScript economics only. No ledger, signatures, public network, or formal completeness claim.', counterexamples: [] };
writeFileSync(new URL('./c1-economics.result.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
