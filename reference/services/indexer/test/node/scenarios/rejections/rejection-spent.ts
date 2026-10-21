/** A separately signed, previously evaluable candidate must fail on the real spent reference. */
import { readAcceptedTransaction } from "@ctvs/integration";
import type { ReadQueries } from "@ctvs/integration/query";
import type { OutRef } from "@ctvs/protocol";
import { expect } from "vitest";
import { write } from "../../support/environment.js";
import type { Flow } from "../../support/flow.js";
import { nodeRpc } from "../../support/rpc.js";
import type { NegativeCandidate } from "./rejection-candidate.js";
import { rejectionAfter, rejectionBefore } from "./rejection-checks.js";

export async function rejectSpent(
  f: Flow,
  requested: ReadQueries,
  candidate: NegativeCandidate,
  consumed: OutRef,
) {
  expect(readAcceptedTransaction(candidate.signedCbor).inputs).toContainEqual(consumed);

  const before = await rejectionBefore(f, requested, candidate);
  const submission = await nodeRpc(f, "submitTransaction", candidate.signedCbor);

  write(f.env.directory, `${candidate.label}-rpc-attempt`, submission);

  if (submission.error?.code === 3997) {
    // The pinned node has an all-inputs-spent mempool shortcut before the structured ledger error.
    expect(submission.error.data).toEqual({
      error: "All inputs are spent. Transaction has probably already been included",
    });

    const inputs = readAcceptedTransaction(candidate.signedCbor).inputs;

    expect(
      await f.w.provider.getUtxosByOutRef(
        inputs.map((ref) => ({ txHash: ref.txId, outputIndex: Number(ref.index) })),
      ),
    ).toEqual([]);
    expect(
      JSON.parse(
        f.env.cli(
          "conway",
          "query",
          "utxo",
          ...inputs.flatMap((ref) => ["--tx-in", `${ref.txId}#${ref.index}`]),
          "--testnet-magic",
          "42",
          "--socket-path",
          "/ipc/node.socket",
          "--out-file",
          "/dev/stdout",
        ),
      ),
    ).toEqual({});
  } else {
    expect(submission.error?.code).toBe(3117);
    expect(submission.error?.data).toMatchObject({
      unknownOutputReferences: expect.arrayContaining([
        { transaction: { id: consumed.txId }, index: Number(consumed.index) },
      ]),
    });
  }

  const after = await rejectionAfter(f, requested, candidate, before);
  const result = {
    label: candidate.label,
    txId: candidate.txId,
    consumed,
    submission,
    before: before.response,
    after,
    nodeRejected: true,
  };

  write(f.env.directory, `${candidate.label}-node-rejection`, result);

  return result;
}
