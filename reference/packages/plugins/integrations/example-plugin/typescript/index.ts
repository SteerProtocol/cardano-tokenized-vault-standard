/** Same stateless fixture semantics as the Rust guest, using the shared WIT types. */
import { get } from "ctvs:example-plugin/http@0.1.0";
import type {
  DiscoveryErrorCode,
  DiscoveryPageV1,
  ExampleDeployment,
} from "../dist/js/interfaces/ctvs-example-plugin-discovery-types.js";
import type { Response } from "../dist/js/interfaces/ctvs-example-plugin-http.js";

function failure(code: DiscoveryErrorCode, message: string): never {
  throw { code, message };
}

function cursorOffset(cursor: string | undefined, total: number): number {
  if (cursor === undefined) return 0;

  const offset = /^(0|[1-9][0-9]*)$/.test(cursor) ? Number(cursor) : NaN;

  if (!Number.isSafeInteger(offset) || offset > total) {
    failure(
      "invalid-cursor",
      "cursor must be a canonical decimal offset within the configured rules",
    );
  }

  return offset;
}

export function discover(
  config: ExampleDeployment,
  cursor: string | undefined,
  pageSize: number,
): DiscoveryPageV1 {
  if (config.network.networkId > 1) failure("invalid-network", "network-id must be 0 or 1");

  if (pageSize === 0 || pageSize > 256) {
    failure("invalid-page-size", "page-size must be between 1 and 256");
  }

  const start = cursorOffset(cursor, config.rules.length);
  const end = Math.min(start + pageSize, config.rules.length);

  return {
    schema: "CTVS-DISCOVERY-1",
    network: config.network,
    rules: config.rules.slice(start, end),
    ...(end < config.rules.length ? { nextCursor: String(end) } : {}),
  };
}

export function fetch(url: string): Response {
  return get(url);
}
