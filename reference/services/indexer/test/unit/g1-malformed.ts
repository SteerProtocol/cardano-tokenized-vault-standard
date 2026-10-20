/** Controlled corruptions of retained real replies test refusal paths; these variants were never node-accepted blocks. */
import assert from "node:assert/strict";
import type { Schema } from "@cardano-ogmios/client";

export type FaultReply = { block: Schema.BlockPraos; tip: Schema.Tip };

function transaction(reply: FaultReply) {
  const tx = reply.block.transactions?.[1];

  assert.ok(tx);

  return tx;
}

export const g1Faults: { name: string; change: (reply: FaultReply, parentSlot: number) => void }[] =
  [
    {
      name: "missing second CBOR",
      change: (r) => {
        delete transaction(r).cbor;
      },
    },
    {
      name: "odd second CBOR",
      change: (r) => {
        transaction(r).cbor = "abc";
      },
    },
    {
      name: "undecodable second CBOR",
      change: (r) => {
        transaction(r).cbor = "ff";
      },
    },
    {
      name: "second transaction ID mismatch",
      change: (r) => {
        transaction(r).id = "ff".repeat(32);
      },
    },
    {
      name: "second validity mismatch",
      change: (r) => {
        transaction(r).spends = "collaterals";
      },
    },
    {
      name: "wrong ancestor",
      change: (r) => {
        r.block.ancestor = "ff".repeat(32);
      },
    },
    {
      name: "negative slot",
      change: (r) => {
        r.block.slot = -1;
      },
    },
    {
      name: "unsafe numeric slot",
      change: (r) => {
        r.block.slot = 9007199254740992;
      },
    },
    {
      name: "non-increasing slot",
      change: (r, parent) => {
        r.block.slot = parent;
      },
    },
    {
      name: "conflicting tip",
      change: (r) => {
        r.tip = { slot: r.block.slot, id: "ff".repeat(32), height: 0 };
      },
    },
    {
      name: "unsupported epoch-boundary block",
      change: (r) => {
        Object.assign(r.block, { type: "ebb" });
      },
    },
  ];
