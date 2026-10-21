/** CLI text and lossless values provide a direct ledger comparison, independent of the projection. */
import { safeJSON } from "@cardano-ogmios/client";
import type { OutRef } from "@ctvs/protocol";
import type { Flow } from "../../support/flow.js";

export function g1Ledger(f: Flow, refs: OutRef[]) {
  const text = f.env.cli(
    "conway",
    "query",
    "utxo",
    ...refs.flatMap((ref) => ["--tx-in", `${ref.txId}#${ref.index}`]),
    "--testnet-magic",
    "42",
    "--socket-path",
    "/ipc/node.socket",
    "--out-file",
    "/dev/stdout",
  );
  const rows = safeJSON.parse(text) as Record<
    string,
    {
      address: string;
      value: Record<string, number | bigint | Record<string, number | bigint>>;
    }
  >;
  const values = Object.fromEntries(
    Object.entries(rows).map(([ref, row]) => {
      const value: Record<string, bigint> = {};

      for (const [policy, quantity] of Object.entries(row.value)) {
        if (typeof quantity === "object")
          for (const [name, amount] of Object.entries(quantity))
            value[`${policy}.${name}`] = BigInt(amount);
        else value[policy === "lovelace" ? "ada" : policy] = BigInt(quantity);
      }

      return [ref, { address: row.address, value }];
    }),
  );

  return { text, values };
}
