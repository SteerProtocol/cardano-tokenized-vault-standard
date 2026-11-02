/** Queue two independent real transactions before forging so their block order can be compared byte for byte. */
import assert from "node:assert/strict";
import { expect } from "vitest";
import { eventually, write } from "../../support/environment.js";
import type { Flow } from "../../support/flow.js";
import { forge, freeze, primary } from "../../support/fork.js";
import { nodeRpc } from "../../support/rpc.js";
import { submit } from "../../support/wallet.js";
import type { Actor } from "../rejections/rejection-common.js";

export async function multiTransactions(f: Flow, actor: Actor) {
  f.w.selectOwner();
  forge(primary(f.env));

  const address = await f.w.lucid.wallet().address();
  const funding = await submit(
    f.env.directory,
    "g1-two-sources",
    f.w.lucid
      .newTx()
      .pay.ToAddress(address, { lovelace: 20000000n })
      .pay.ToAddress(address, { lovelace: 30000000n }),
    f.w.provider,
  );

  f.receipts.push(funding);
  await freeze(primary(f.env));

  const sources = await f.w.provider.getUtxosByOutRef(
    [0, 1].map((outputIndex) => ({ txHash: funding.txId, outputIndex })),
  );

  expect(sources).toHaveLength(2);

  const records: {
    txId: string;
    signedCbor: string;
    submission: Awaited<ReturnType<typeof nodeRpc>>;
  }[] = [];

  for (const source of sources) {
    const built = await f.w.lucid
      .newTx()
      .collectFrom([source])
      .pay.ToAddress(actor.address, { lovelace: 2000000n })
      .complete({ coinSelection: false, localUPLCEval: false });
    const signed = await built.sign.withWallet().complete();
    const submission = await nodeRpc(f, "submitTransaction", signed.toCBOR());

    expect(submission.result).toEqual({ transaction: { id: signed.toHash() } });
    assert.equal(submission.error, undefined);
    records.push({ txId: signed.toHash(), signedCbor: signed.toCBOR(), submission });
  }

  forge(primary(f.env));
  await eventually(
    async () =>
      (
        await f.w.provider.getUtxosByOutRef(
          records.map((row) => ({ txHash: row.txId, outputIndex: 0 })),
        )
      ).length === 2
        ? true
        : undefined,
    "both queued key transactions included",
  );
  await freeze(primary(f.env));
  write(f.env.directory, "g1-multiple-transactions", records);

  return records;
}
