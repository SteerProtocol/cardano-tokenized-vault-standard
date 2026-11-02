/** Typed application query client. Every read is one request; no node, projection, wallet or implicit retry. */
import type { Address, OutRef } from "@ctvs/protocol";
import { network } from "../query/domain.js";
import {
  decodeQueryResponse,
  encodeReadRequest,
  type MethodResponse,
  type PreviewInput,
  parseVaultPolicy,
  QUERY_BUDGET,
  QueryError,
  type QueryResponse,
  type ReadQueries,
  type ShareInput,
  same,
  type ViewBasis,
} from "../query/index.js";
import type { NetworkBinding } from "../types.js";
import { queryFetch } from "./http.js";

export interface ClientOptions {
  baseUrl: string;
  expectedNetwork: NetworkBinding;
  timeoutMs?: number;
  fetch?: typeof fetch;
}
export interface ReadOptions {
  signal?: AbortSignal;
  expectedBasis?: ViewBasis;
}

export function createIndexerClient(options: ClientOptions) {
  const base = new URL(options.baseUrl);

  if (
    !/^https?:$/.test(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new QueryError(
      "INVALID_REQUEST",
      "baseUrl must be an HTTP(S) endpoint without credentials/query/fragment",
    );

  const expectedNetwork = network.decode(network.encode(options.expectedNetwork));
  const timeoutMs = options.timeoutMs ?? QUERY_BUDGET.timeoutMs;

  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
    throw new QueryError("INVALID_REQUEST", "timeout must be a positive safe integer");

  const fetcher = options.fetch ?? globalThis.fetch;

  const endpoint = (path: string) => new URL(`${base.pathname.replace(/\/$/, "")}${path}`, base);

  const signal = (read?: ReadOptions) =>
    read?.signal
      ? AbortSignal.any([read.signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);

  function vault(identity: string) {
    const policy = parseVaultPolicy(identity.toLowerCase());

    async function read<Q extends ReadQueries>(
      queries: Q,
      readOptions?: ReadOptions,
    ): Promise<QueryResponse<Q>> {
      const body = encodeReadRequest(queries, readOptions?.expectedBasis);

      if (new TextEncoder().encode(body).length > QUERY_BUDGET.bodyBytes)
        throw new QueryError("QUERY_LIMIT", "request exceeds budget", 413);

      const raw = await queryFetch(fetcher, endpoint(`/v1/vaults/${policy}/read`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: signal(readOptions),
      });

      const decoded = decodeQueryResponse(raw, queries, policy, expectedNetwork);

      if (readOptions?.expectedBasis && !same(readOptions.expectedBasis, decoded.basis))
        throw new QueryError("INVALID_RESPONSE", "response does not satisfy expected basis", 502);

      return decoded;
    }

    async function one<K extends keyof ReadQueries>(
      method: K,
      input: NonNullable<ReadQueries[K]>,
      readOptions?: ReadOptions,
    ): Promise<MethodResponse<K>> {
      const response = await read({ [method]: input } as Pick<ReadQueries, K>, readOptions);

      return { ...response, kind: method, data: response.data[method] } as MethodResponse<K>;
    }

    return {
      read,
      snapshot: (o?: ReadOptions) => one("snapshot", true, o),
      convertToAssets: (input: { shares: bigint }, o?: ReadOptions) =>
        one("convertToAssets", input, o),
      convertToShares: (input: { assets: bigint }, o?: ReadOptions) =>
        one("convertToShares", input, o),
      previewDeposit: (input: PreviewInput, o?: ReadOptions) => one("previewDeposit", input, o),
      previewMint: (input: ShareInput, o?: ReadOptions) => one("previewMint", input, o),
      previewWithdraw: (input: PreviewInput, o?: ReadOptions) => one("previewWithdraw", input, o),
      previewRedeem: (input: ShareInput, o?: ReadOptions) => one("previewRedeem", input, o),
      ownership: (input: { address: Address }, o?: ReadOptions) => one("ownership", input, o),
      context: (o?: ReadOptions) => one("context", true, o),
      request: (input: { ref: OutRef }, o?: ReadOptions) => one("request", input, o),
      claim: (input: { ref: OutRef }, o?: ReadOptions) => one("claim", input, o),
      recoverySource: (input: { ref: OutRef }, o?: ReadOptions) => one("recoverySource", input, o),
    };
  }

  async function discover(share: string, readOptions?: Pick<ReadOptions, "signal">) {
    const policy = parseVaultPolicy(share.split(".")[0]);

    if (share !== `${policy}.5348415245`)
      throw new QueryError("INVALID_REQUEST", "exact SHARE identity required");

    const url = endpoint("/v1/discover");

    url.searchParams.set("share", share);

    const raw = await queryFetch(fetcher, url, { signal: signal(readOptions) });

    return decodeQueryResponse(raw, { snapshot: true }, policy, expectedNetwork);
  }

  return { vault, discover };
}

export type IndexerClient = ReturnType<typeof createIndexerClient>;
export { QueryError } from "../query/schema.js";
export type { ReadQueries, ViewBasis } from "../query/types.js";
