/** Exercise the installed Kupmios transport, rather than a bigint conversion copied from its implementation. */

import { rmSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { createProvider, kupoReachable } from "../../src/chain/kupo.js";
import { setup } from "./fixtures.js";

afterEach(() => vi.unstubAllGlobals());

it("requests string quantities and preserves an asset balance above 2^53 over HTTP", async () => {
  const f = setup();
  const address = f.genesis.tx.outputs[0]?.address;
  const quantity = "9007199254740993";
  const unit = `${f.policy}.${"ab"}`;
  const mock = vi.fn(async (_input: unknown, options?: RequestInit) => {
    expect(new Headers(options?.headers).get("accept")).toBe(
      "application/json;asset-quantity=string",
    );

    return new Response(
      JSON.stringify([
        {
          transaction_index: 0,
          transaction_id: "aa".repeat(32),
          output_index: 0,
          address,
          value: { coins: "2000000", assets: { [unit]: quantity } },
          datum_hash: null,
          script_hash: null,
          datum_type: "hash",
          datum: null,
          script: null,
          created_at: { slot_no: 1, header_hash: f.block.point.blockHash },
          spent_at: null,
        },
      ]),
      { headers: { "content-type": "application/json" } },
    );
  });

  vi.stubGlobal("fetch", mock);

  try {
    const result = await createProvider(f.config).getUtxos(address ?? "");

    expect(result[0]?.assets[unit.replace(".", "")]).toBe(BigInt(quantity));
    expect(mock).toHaveBeenCalledOnce();
  } finally {
    rmSync(f.directory, { recursive: true });
  }
});

it("treats health as reachability only and returns unavailable on transport failures", async () => {
  const f = setup();

  try {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}")),
    );
    expect(await kupoReachable(f.config)).toBe(true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 503 })),
    );
    expect(await kupoReachable(f.config)).toBe(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    expect(await kupoReachable(f.config)).toBe(false);
  } finally {
    rmSync(f.directory, { recursive: true });
  }
});

it("cancels an outstanding Kupo health probe when the service stops", async () => {
  const f = setup();
  const controller = new AbortController();

  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (_url: unknown, options?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    ),
  );

  try {
    const probe = kupoReachable(f.config, controller.signal);

    controller.abort();
    expect(await probe).toBe(false);
  } finally {
    rmSync(f.directory, { recursive: true });
  }
});
