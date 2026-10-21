/** Cross-field coherence checks supplement schema validation; they are not consensus or economic proofs. */
import type { Deployment } from "@ctvs/planning";
import { QueryError } from "./schema.js";
import {
  type ConstructionContext,
  ECONOMIC_METHODS,
  type EconomicView,
  type QueryResponse,
  type QueryResults,
  type ReadQueries,
} from "./types.js";

export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  if (
    !a ||
    !b ||
    typeof a !== "object" ||
    typeof b !== "object" ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false;

  const left = a as Record<string, unknown>,
    right = b as Record<string, unknown>;
  const keys = Object.keys(left);

  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && same(left[key], right[key]))
  );
}

function disagree(): never {
  throw new QueryError("INVALID_RESPONSE", "response contains incompatible sources", 502);
}

function assertDeployment(deployment: Deployment, response: QueryResponse) {
  if (
    deployment.policy !== response.vault.policy ||
    deployment.family !== response.implementation.family ||
    deployment.buildId !== response.implementation.buildId ||
    deployment.network !== response.network.name ||
    deployment.networkDomain !== response.network.domain ||
    deployment.termsHash !== response.evidence.termsHash ||
    !same(deployment.configRef, response.vault.configRef) ||
    !same(deployment.chainPoint, response.chainPoint)
  )
    disagree();

  if ((deployment.family === "ctvs1") !== (deployment.claimScript === null)) disagree();
}

function assertContext(context: ConstructionContext, response: QueryResponse) {
  assertDeployment(context.deployment, response);

  if (
    !same(context.stateInput.ref, response.evidence.state) ||
    context.terms.networkDomain !== response.network.domain ||
    context.stateInput.address.payment.type !== "script" ||
    context.stateInput.address.payment.hash !== response.vault.policy ||
    context.stateInput.address.stake !== null
  )
    disagree();
}

function assertEconomic(view: EconomicView, response: QueryResponse, data: Partial<QueryResults>) {
  const key = view.method;
  const assetsInput =
    key === "convertToShares" || key === "previewDeposit" || key === "previewWithdraw";

  if (
    view.inputUnit !== (assetsInput ? "assets" : "shares") ||
    view.outputUnit === view.inputUnit ||
    view.units.shares !== response.vault.share ||
    !same(view.units.assets, view.feeUnits.protocol)
  )
    disagree();

  if (
    view.quote &&
    (view.quote.operation !== key.slice(7).toLowerCase() || view.quote.amount !== view.amount)
  )
    disagree();

  assertEconomicContext(view, response, data);
}

function assertEconomicContext(
  view: EconomicView,
  response: QueryResponse,
  data: Partial<QueryResults>,
) {
  if (view.construction) {
    assertContext(view.construction, response);

    if (!same(view.units.assets, view.construction.terms.underlying)) disagree();
  }

  if (data.snapshot && !same(view.units.assets, data.snapshot.terms.underlying)) disagree();

  if (view.construction && data.context && !same(view.construction, data.context)) disagree();
}

function assertLifecycle(
  data: Partial<QueryResults>,
  response: QueryResponse,
  queries: ReadQueries,
) {
  if (
    data.request &&
    (!same(data.request.ref, queries.request?.ref) ||
      !same(data.request.ref, data.request.source.ref) ||
      data.request.policy !== response.vault.policy)
  )
    disagree();

  if (
    data.claim &&
    (!same(data.claim.ref, queries.claim?.ref) ||
      !same(data.claim.ref, data.claim.source.ref) ||
      data.claim.claim.vaultPolicy !== response.vault.policy)
  )
    disagree();
}

export function assertResultBindings<Q extends ReadQueries>(
  response: QueryResponse<Q>,
  queries: Q,
): void {
  const envelope = response as QueryResponse;
  const data = response.data as Partial<QueryResults>;

  if (data.context) assertContext(data.context, envelope);

  for (const key of ECONOMIC_METHODS) {
    const view = data[key];

    if (!view) continue;

    assertEconomic(view, envelope, data);

    const input = queries[key];
    const included = input && "include" in input && input.include?.includes("construction");

    if (!!included !== !!view.construction) disagree();
  }

  if (
    data.snapshot &&
    (data.snapshot.state.vaultPolicy !== response.vault.policy ||
      data.snapshot.state.termsHash !== response.evidence.termsHash)
  )
    disagree();

  assertLifecycle(data, envelope, queries);

  if (data.recoverySource) {
    assertDeployment(data.recoverySource.deployment, envelope);

    if (!same(data.recoverySource.source.ref, queries.recoverySource?.ref)) disagree();
  }
}
