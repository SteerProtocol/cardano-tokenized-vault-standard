import { readFile } from 'node:fs/promises';

const fixtureUrl = new URL('../fixtures/conformance-v0.json', import.meta.url);
const vectors = JSON.parse(await readFile(fixtureUrl, 'utf8'));
const BPS = BigInt(vectors.feeScale);

const floorDiv = (numerator, denominator) => numerator <= 0n || denominator <= 0n ? 0n : numerator / denominator;
const ceilDiv = (numerator, denominator) => numerator <= 0n || denominator <= 0n ? 0n : (numerator + denominator - 1n) / denominator;
const feeOnRaw = (amount, bps) => ceilDiv(amount * bps, BPS);
const feeOnTotal = (amount, bps) => ceilDiv(amount * bps, BPS + bps);
const toSharesDown = (state, assets) => floorDiv(assets * (state.totalShares + state.virtualShares), state.totalAssets + state.virtualAssets);
const toSharesUp = (state, assets) => ceilDiv(assets * (state.totalShares + state.virtualShares), state.totalAssets + state.virtualAssets);
const toAssetsUp = (state, shares) => ceilDiv(shares * (state.totalAssets + state.virtualAssets), state.totalShares + state.virtualShares);

function quote(vector) {
  const state = Object.fromEntries(Object.entries(vector.state).map(([key, value]) => [key, BigInt(value)]));
  const fees = Object.fromEntries(Object.entries(vector.fees).map(([key, value]) => [key, BigInt(value)]));
  const amount = BigInt(vector.amount);

  if (vector.action === 'deposit') {
    const feeAssets = feeOnTotal(amount, fees.entryFeeBps);
    const netAssets = amount - feeAssets;
    return { grossAssets: amount, netAssets, feeAssets, shares: toSharesDown(state, netAssets) };
  }

  if (vector.action === 'mint') {
    const netAssets = toAssetsUp(state, amount);
    const feeAssets = feeOnRaw(netAssets, fees.entryFeeBps);
    return { grossAssets: netAssets + feeAssets, netAssets, feeAssets, shares: amount };
  }

  if (vector.action === 'withdraw') {
    const feeAssets = feeOnRaw(amount, fees.exitFeeBps);
    const grossAssets = amount + feeAssets;
    return { grossAssets, netAssets: amount, feeAssets, shares: toSharesUp(state, grossAssets) };
  }

  throw new Error(`Unsupported action: ${vector.action}`);
}

const bigintRecord = (record) => Object.fromEntries(
  Object.entries(record).map(([key, value]) => [key, BigInt(value)]),
);

function rawStateAsset(state, underlying) {
  const economic = state.totalAssets + state.accruedFeeAssets;
  return underlying === 'ada' ? economic + state.storageLovelace : economic;
}

function accountingTransition(vector) {
  const before = bigintRecord(vector.before);
  const actionQuote = bigintRecord(vector.quote);
  const beforeRaw = rawStateAsset(before, vector.underlying);

  if (vector.action === 'deposit' || vector.action === 'mint') {
    return {
      totalAssets: before.totalAssets + actionQuote.netAssets,
      accruedFeeAssets: before.accruedFeeAssets + actionQuote.feeAssets,
      storageLovelace: before.storageLovelace,
      rawAssetAmount: beforeRaw + actionQuote.grossAssets,
    };
  }

  if (vector.action === 'withdraw' || vector.action === 'redeem') {
    return {
      totalAssets: before.totalAssets - actionQuote.grossAssets,
      accruedFeeAssets: before.accruedFeeAssets + actionQuote.feeAssets,
      storageLovelace: before.storageLovelace,
      rawAssetAmount: beforeRaw - actionQuote.netAssets,
    };
  }

  if (vector.action === 'claimFees') {
    return {
      totalAssets: before.totalAssets,
      accruedFeeAssets: 0n,
      storageLovelace: before.storageLovelace,
      rawAssetAmount: beforeRaw - actionQuote.feeAssets,
    };
  }

  throw new Error(`Unsupported accounting action: ${vector.action}`);
}

let failures = 0;
for (const vector of vectors.cases) {
  const actual = quote(vector);
  const expected = Object.fromEntries(Object.entries(vector.expected).map(([key, value]) => [key, BigInt(value)]));
  const matches = Object.keys(expected).every((key) => actual[key] === expected[key]);
  if (matches) {
    console.log(`PASS ${vector.name}`);
  } else {
    failures += 1;
    console.error(`FAIL ${vector.name}`);
    console.error({ expected, actual });
  }
}

for (const vector of vectors.accountingCases ?? []) {
  const actual = accountingTransition(vector);
  const expected = bigintRecord(vector.after);
  const actionQuote = bigintRecord(vector.quote);
  const closedValue = actual.rawAssetAmount === rawStateAsset(actual, vector.underlying);
  const balancedQuote = actionQuote.grossAssets === actionQuote.netAssets + actionQuote.feeAssets;
  const fullFeeClaim = vector.action !== 'claimFees' || (
    actionQuote.netAssets === 0n
    && actionQuote.grossAssets === actionQuote.feeAssets
    && actionQuote.feeAssets === BigInt(vector.before.accruedFeeAssets)
  );
  const matches = Object.keys(expected).every((key) => actual[key] === expected[key]);

  if (matches && closedValue && balancedQuote && fullFeeClaim) {
    console.log(`PASS ${vector.name}`);
  } else {
    failures += 1;
    console.error(`FAIL ${vector.name}`);
    console.error({ expected, actual, closedValue, balancedQuote, fullFeeClaim });
  }
}

if (failures > 0) {
  process.exitCode = 1;
} else {
  const accountingCount = vectors.accountingCases?.length ?? 0;
  console.log(`Validated ${vectors.cases.length + accountingCount} CTVS economic conformance vectors.`);
}
