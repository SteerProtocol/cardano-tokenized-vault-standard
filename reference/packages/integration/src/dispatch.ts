/** Serial query dispatch over one already-published reader. Transport hosts supply readiness and recovery identity. */

import {
  QUERY_VERSION,
  QueryError,
  type QueryResponse,
  type ReadQueries,
  type ReadRequest,
  same,
  type ViewBasis,
} from "./query/index.js";
import type { VaultReader } from "./reader.js";

export type QueryReader = Pick<
  VaultReader,
  | "snapshot"
  | "convertToAssets"
  | "convertToShares"
  | "previewDeposit"
  | "previewMint"
  | "previewWithdraw"
  | "previewRedeem"
  | "ownership"
  | "constructionContext"
  | "requestView"
  | "claimView"
  | "recoverySource"
>;

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new QueryError("INVALID_REQUEST", "query argument missing");

  return value;
}

function result(
  reader: QueryReader,
  policy: string,
  key: keyof ReadQueries,
  queries: ReadQueries,
): unknown {
  switch (key) {
    case "snapshot":
      return reader.snapshot(policy).data;
    case "convertToAssets":
      return reader.convertToAssets(policy, required(queries.convertToAssets)).data;
    case "convertToShares":
      return reader.convertToShares(policy, required(queries.convertToShares)).data;
    case "previewDeposit":
      return reader.previewDeposit(policy, required(queries.previewDeposit)).data;
    case "previewMint":
      return reader.previewMint(policy, required(queries.previewMint)).data;
    case "previewWithdraw":
      return reader.previewWithdraw(policy, required(queries.previewWithdraw)).data;
    case "previewRedeem":
      return reader.previewRedeem(policy, required(queries.previewRedeem)).data;
    case "ownership":
      return reader.ownership(policy, required(queries.ownership).address).data;
    case "context":
      return reader.constructionContext(policy);
    case "request":
      return reader.requestView(policy, required(queries.request).ref).data;
    case "claim":
      return reader.claimView(policy, required(queries.claim).ref).data;
    case "recoverySource":
      return reader.recoverySource(policy, required(queries.recoverySource).ref);
  }
}

export function dispatchRead<Q extends ReadQueries>(
  reader: QueryReader,
  policy: string,
  request: ReadRequest & { queries: Q },
  session: Pick<ViewBasis, "instance" | "recoveryGeneration">,
): QueryResponse<Q> {
  const snapshot = reader.snapshot(policy);
  const basis: ViewBasis = {
    instance: session.instance,
    recoveryGeneration: session.recoveryGeneration,
    chainPoint: snapshot.chainPoint,
    stateRef: snapshot.evidence.state,
  };

  if (request.expectedBasis && !same(request.expectedBasis, basis))
    throw new QueryError("STALE_BASIS", "reader basis changed; refresh all requested data", 409);

  const data = Object.fromEntries(
    (Object.keys(request.queries) as (keyof ReadQueries)[]).map((key) => [
      key,
      result(reader, policy, key, request.queries),
    ]),
  );

  return { ...snapshot, kind: "query", apiVersion: QUERY_VERSION, basis, data } as QueryResponse<Q>;
}
