/** Submit test-only RPC calls to the actual disposable ledger. */
import assert from "node:assert/strict";
import type { RpcReply } from "../../support/evidence/rpc.js";
import type { Flow } from "./flow.js";

export async function nodeRpc(
  f: Flow,
  method: "evaluateTransaction" | "submitTransaction",
  cbor: string,
): Promise<RpcReply> {
  const response = await fetch(f.env.config.sources.ogmios, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method,
      params: { transaction: { cbor } },
      id: "sdk07-rejections",
    }),
    signal: AbortSignal.timeout(15000),
  });

  assert.ok(response.ok || response.status === 400, `Ogmios transport ${response.status}`);

  return response.json();
}
