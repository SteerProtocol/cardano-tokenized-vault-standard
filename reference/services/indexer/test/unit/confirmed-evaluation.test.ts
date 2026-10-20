/** Supplemental hints cannot replace chain evidence or silently narrow a large native quantity. */
import { readFileSync } from "node:fs";
import { credentialToAddress, scriptFromNative, type UTxO } from "@lucid-evolution/lucid";
import { expect, it, vi } from "vitest";
import { confirmedEvaluator } from "../support/evaluation.js";

const fixture = JSON.parse(
  readFileSync(new URL("../fixtures/accepted/ctvs1-ada-direct.json", import.meta.url), "utf8"),
) as { blocks: { transactions: string[] }[] };
const cbor = fixture.blocks.flatMap((block) => block.transactions)[0];

if (!cbor) throw new Error("missing accepted transaction fixture");

const source: UTxO = {
  txHash: "aa".repeat(32),
  outputIndex: 0,
  address: credentialToAddress("Custom", { type: "Key", hash: "11".repeat(28) }),
  assets: {
    lovelace: 5000000n,
    [`${"bb".repeat(28)}01`]: 9007199254740993n,
  },
};

it("checks exact confirmed outputs and evaluates via the ledger with no supplemental JSON", async () => {
  const provider = {
    getUtxosByOutRef: vi.fn(async () => [source]),
    evaluateTx: vi.fn(async () => []),
  };
  const record = vi.fn();

  await confirmedEvaluator(provider, record)(cbor, [structuredClone(source)]);
  expect(provider.getUtxosByOutRef).toHaveBeenCalledWith([
    { txHash: source.txHash, outputIndex: 0 },
  ]);
  expect(provider.evaluateTx).toHaveBeenCalledExactlyOnceWith(cbor);
  expect(record).toHaveBeenCalledWith({
    txId: expect.any(String),
    source: "node_ledger",
    confirmedRefs: [`${source.txHash}#0`],
    redeemers: 0,
  });
});

it.each(["missing", "amount", "address", "datum", "script"])(
  "rejects %s supplemental evidence before evaluation",
  async (mode) => {
    const actual = structuredClone(source);

    if (mode === "amount") actual.assets = { lovelace: 5000000n };

    if (mode === "address")
      actual.address = credentialToAddress("Custom", { type: "Key", hash: "22".repeat(28) });

    if (mode === "datum") actual.datum = "d87980";

    if (mode === "script")
      actual.scriptRef = scriptFromNative({ type: "sig", keyHash: "33".repeat(28) });

    const provider = {
      getUtxosByOutRef: vi.fn(async () => (mode === "missing" ? [] : [actual])),
      evaluateTx: vi.fn(async () => []),
    };
    const record = vi.fn();

    await expect(confirmedEvaluator(provider, record)(cbor, [source])).rejects.toThrow(
      "matching confirmed input",
    );
    expect(provider.evaluateTx).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  },
);

it("delegates ordinary signed evaluation and propagates node rejection", async () => {
  const provider = {
    getUtxosByOutRef: vi.fn(async () => []),
    evaluateTx: vi.fn(async () => {
      throw new Error("ledger rejected");
    }),
  };
  const record = vi.fn();

  await expect(confirmedEvaluator(provider, record)(cbor)).rejects.toThrow("ledger rejected");
  expect(provider.getUtxosByOutRef).not.toHaveBeenCalled();
  expect(record).not.toHaveBeenCalled();
});
