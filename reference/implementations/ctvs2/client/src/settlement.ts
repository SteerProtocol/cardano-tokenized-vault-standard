/** Per-Request eligibility, pricing and gross-flow accounting used by snapshot batch construction. */
import type { AsyncDeployment, ProtectedInput } from "@ctvs/planning";
import { assertProtectedInput, assertSameValue, ownAsset, requestValue } from "@ctvs/planning";
import type { Claim, Quote, Request, State, Terms } from "@ctvs/protocol";
import {
  assertEnabled,
  equalHex,
  positive,
  preview,
  quantity,
  requestFromData,
} from "@ctvs/protocol";

export interface BatchRequest {
  input: ProtectedInput;
  /** External lovelace carried by this Request's Claim in addition to its remaining Request reserve. */
  claimTopup?: bigint;
}
export interface SettledRequest {
  source: ProtectedInput;
  request: Request;
  quote: Quote;
  claim: Claim;
  claimTopup: bigint;
}
export interface BatchTotals {
  depositedGross: bigint;
  depositedNet: bigint;
  redeemedGross: bigint;
  redeemedNet: bigint;
  issued: bigint;
  burned: bigint;
  fees: bigint;
  reward: bigint;
}

export function emptyTotals(): BatchTotals {
  return {
    depositedGross: 0n,
    depositedNet: 0n,
    redeemedGross: 0n,
    redeemedNet: 0n,
    issued: 0n,
    burned: 0n,
    fees: 0n,
    reward: 0n,
  };
}

/**
 * Validate one protected Request against supplied deployment, Terms, State and interval upper bound.
 * Require full economic decoding, exact escrow value, an enabled/unpaused direction and a positive
 * quote meeting minimumOutput. All Requests in a batch must receive the same input State.
 * Return a Claim linked to that Request/State; carried ADA is storage plus execution budget minus
 * settler fee plus external claimTopup. Aggregate successor liquidity/cap checks belong to the batch.
 */
export function settleRequest(
  candidate: BatchRequest,
  deployment: AsyncDeployment,
  state: State,
  stateInput: ProtectedInput,
  terms: Terms,
  upperPosixMs: bigint,
): SettledRequest {
  const { input: source } = candidate,
    claimTopup = quantity(candidate.claimTopup ?? 0n, "claim topup");

  assertProtectedInput(source, deployment.policy);

  const request = requestFromData(source.datum),
    { recovery, body } = request;

  if (
    !equalHex(recovery.vaultPolicy, deployment.policy) ||
    !equalHex(body.termsHash, deployment.termsHash)
  )
    throw new Error("request deployment mismatch");

  if (upperPosixMs > recovery.deadlinePosixMs)
    throw new Error("batch validity exceeds request deadline");

  assertSameValue(source.value, requestValue(request, terms));

  const entry = body.kind === "deposit";

  assertEnabled(state, terms, entry, true);

  const quote = preview(body.kind, body.offered, state, terms);

  positive(quote.shares);
  positive(quote.netAssets);
  positive(quote.grossAssets);
  quantity(quote.fee);

  const economic = entry ? quote.shares : quote.netAssets;

  if (economic < body.minimumOutput) throw new Error("request minimum violated");

  const claim: Claim = {
    vaultPolicy: deployment.policy,
    requestRef: source.ref,
    stateRef: stateInput.ref,
    termsHash: deployment.termsHash,
    asset: entry ? ownAsset(deployment.policy, "share") : terms.underlying,
    economicQuantity: economic,
    receiver: body.receiver,
    // Only the agreed settler fee leaves Request ADA; reserves and explicit top-ups follow the Claim.
    carriedLovelace: body.storageLovelace + body.executionBudget - body.settlerFee + claimTopup,
  };

  return { source, request, quote, claim, claimTopup };
}

/**
 * Mutate totals with one previously validated settlement, tracking issued/burned and gross/net
 * asset flows separately. Offsetting Requests must not hide an individual aggregate overflow.
 * All totals are bounded after addition. If a bound throws, the caller must discard the local
 * totals object because partial additions are not rolled back.
 */
export function accumulate(totals: BatchTotals, settled: SettledRequest): void {
  const { request, quote } = settled;

  if (request.body.kind === "deposit") {
    totals.depositedGross += quote.grossAssets;
    totals.depositedNet += quote.netAssets;
    totals.issued += quote.shares;
  } else {
    totals.redeemedGross += quote.grossAssets;
    totals.redeemedNet += quote.netAssets;
    totals.burned += quote.shares;
  }

  totals.fees += quote.fee;
  totals.reward += request.body.settlerFee;

  for (const [name, amount] of Object.entries(totals)) quantity(amount, `aggregate ${name}`);
}
