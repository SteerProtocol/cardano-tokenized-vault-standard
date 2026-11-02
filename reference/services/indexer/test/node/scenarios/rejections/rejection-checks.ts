/** A rejected candidate must leave accepted history, UTxOs and all public SDK fields unchanged. */
import assert from "node:assert/strict";
import { readAcceptedTransaction } from "@ctvs/integration";
import type { ReadQueries } from "@ctvs/integration/query";
import type { OutRef } from "@ctvs/protocol";
import { refId } from "@ctvs/protocol";
import { CML, withCMLScope } from "@lucid-evolution/lucid";
import { expect } from "vitest";
import { journalSnapshot, write } from "../../support/environment.js";
import type { Flow } from "../../support/flow.js";
import { statelessRead } from "../../support/persistence.js";
import type { NegativeCandidate } from "./rejection-candidate.js";

function ledger(f: Flow, refs: OutRef[]) {
  return f.env.cli(
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
}

export async function rejectionBefore(
  f: Flow,
  requested: ReadQueries,
  candidate: NegativeCandidate,
) {
  const transaction = readAcceptedTransaction(candidate.signedCbor);
  const collateral = withCMLScope((own) => {
    const body = own(own(CML.Transaction.from_cbor_hex(candidate.signedCbor)).body());
    const optional = body.collateral_inputs();

    assert.ok(optional);

    const inputs = own(optional);

    return Array.from({ length: inputs.len() }, (_, index) => {
      const input = own(inputs.get(index));

      return { txId: own(input.transaction_id()).to_hex(), index: input.index() };
    });
  });
  const refs = [
    ...new Map(
      [...transaction.inputs, ...transaction.referenceInputs, ...collateral].map((ref) => [
        refId(ref),
        ref,
      ]),
    ).values(),
  ];
  const response = await statelessRead(f, requested, `${candidate.label}-before`);

  expect(transaction.valid).toBe(true);
  assert.ok(transaction.inputs.length > 0);

  return { response, refs, ledger: ledger(f, refs), journal: journalSnapshot(f.env) };
}

export async function rejectionAfter(
  f: Flow,
  requested: ReadQueries,
  candidate: NegativeCandidate,
  before: Awaited<ReturnType<typeof rejectionBefore>>,
) {
  const after = await statelessRead(f, requested, `${candidate.label}-after`);

  expect(after).toEqual(before.response);
  expect(journalSnapshot(f.env)).toEqual(before.journal);
  // Raw CLI text preserves quantities above 2^53 without numeric JSON parsing.
  expect(ledger(f, before.refs)).toBe(before.ledger);
  expect(await f.w.provider.getUtxosByOutRef([{ txHash: candidate.txId, outputIndex: 0 }])).toEqual(
    [],
  );
  write(f.env.directory, `${candidate.label}-unchanged`, {
    txId: candidate.txId,
    before: before.response,
    after,
    exactCliUtxos: before.ledger,
    journalUnchanged: true,
    retainedFreshReplayParity: true,
  });

  return after;
}
