/** Bind decoded data to the requested network, vault, methods and one exact response basis. */

import type { NetworkBinding } from "../types.js";
import { assertResultBindings, same } from "./basis.js";
import { basisCodec } from "./request.js";
import { envelopeFields, resultsCodec } from "./results.js";
import { fields, literal, QueryError } from "./schema.js";
import { ECONOMIC_METHODS, QUERY_VERSION, type QueryResponse, type ReadQueries } from "./types.js";

export function encodeQueryResponse<Q extends ReadQueries>(response: QueryResponse<Q>): string {
  try {
    const codec = fields({
      ...envelopeFields,
      apiVersion: literal(QUERY_VERSION),
      basis: basisCodec,
      data: resultsCodec(Object.keys(response.data)),
    });
    const wire = codec.encode(response);

    codec.decode(wire);

    return JSON.stringify(wire);
  } catch {
    throw new QueryError("INTERNAL_ERROR", "query result violates the response contract", 500);
  }
}

export function decodeQueryResponse<Q extends ReadQueries>(
  raw: unknown,
  queries: Q,
  policy: string,
  expectedNetwork: NetworkBinding,
): QueryResponse<Q> {
  try {
    const codec = fields({
      ...envelopeFields,
      apiVersion: literal(QUERY_VERSION),
      basis: basisCodec,
      data: resultsCodec(Object.keys(queries)),
    });
    const response = codec.decode(raw) as QueryResponse<Q>;

    for (const key of Object.keys(expectedNetwork) as (keyof NetworkBinding)[])
      if (response.network[key] !== expectedNetwork[key])
        throw new QueryError("NETWORK_MISMATCH", "response network differs", 502);

    if (
      response.vault.policy !== policy ||
      response.vault.share !== `${policy}.5348415245` ||
      !same(response.chainPoint, response.basis.chainPoint) ||
      !same(response.evidence.state, response.basis.stateRef)
    )
      throw new QueryError("INVALID_RESPONSE", "response evidence disagrees with its basis", 502);

    for (const name of ECONOMIC_METHODS) {
      if (!(name in queries)) continue;

      const data = response.data as Record<string, unknown>;
      const economic = data[name] as { method: string; amount: bigint };
      const input = queries[name] as { assets?: bigint; shares?: bigint };

      if (economic.method !== name || economic.amount !== (input.assets ?? input.shares))
        throw new QueryError("INVALID_RESPONSE", "economic result does not match request", 502);
    }

    assertResultBindings(response, queries);

    return response;
  } catch (error) {
    if (error instanceof QueryError && error.code === "NETWORK_MISMATCH") throw error;

    throw new QueryError("INVALID_RESPONSE", "invalid query response", 502);
  }
}

export { same } from "./basis.js";
