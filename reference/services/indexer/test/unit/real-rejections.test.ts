/** Rejected candidates stay outside recorded accepted history; every retained combined read replays exactly. */
import assert from "node:assert/strict";
import { dispatchRead, type NetworkBinding, readAcceptedTransaction } from "@ctvs/integration";
import {
  decodeQueryResponse,
  decodeReadRequest,
  ECONOMIC_METHODS,
  type ReadQueries,
} from "@ctvs/integration/query";
import { refId } from "@ctvs/protocol";
import { expect, it } from "vitest";
import ada1 from "../fixtures/accepted/ctvs1-ada-rejections.json" with { type: "json" };
import native1 from "../fixtures/accepted/ctvs1-native-rejections.json" with { type: "json" };
import ada2 from "../fixtures/accepted/ctvs2-ada-rejections.json" with { type: "json" };
import native2 from "../fixtures/accepted/ctvs2-native-rejections.json" with { type: "json" };
import { compiledFailure, evaluated, type RpcReply } from "../support/evidence/rpc.js";
import { projection } from "./native-rollback-fixture.js";

const fixtures = [ada1, native1, ada2, native2];

type Fixture = (typeof fixtures)[number];

const cases = fixtures.map((fixture) => ({
  fixture,
  label: `${fixture.expected.family} ${fixture.expected.underlying === "ada" ? "ada" : "native"}`,
}));

function at(fixture: Fixture, hash: string) {
  const index = fixture.blocks.findIndex((block) => block.point.blockHash === hash);

  assert.ok(index >= 0, "recorded response basis must exist in accepted history");

  const reader = projection(fixture);

  for (const block of fixture.blocks.slice(0, index + 1))
    reader.rollForward({
      ...block,
      point: { ...block.point, slot: BigInt(block.point.slot) },
      parent: { ...block.parent, slot: BigInt(block.parent.slot) },
    });

  return reader;
}

it.each(cases)("keeps rejected $label CBOR outside actual accepted history", ({ fixture }) => {
  const accepted = fixture.blocks.flatMap((block) =>
    block.transactions.map((cbor) => readAcceptedTransaction(cbor)),
  );
  const ids = accepted.map((tx) => tx.id);

  expect(fixture.provenance.rejectedTransactionsWereIncluded).toBe(false);
  expect(fixture.rejected).toHaveLength(fixture.expected.family === "ctvs1" ? 14 : 29);
  expect(new Set(fixture.rejected.map((row) => row.txId)).size).toBe(fixture.rejected.length);

  for (const row of fixture.rejected) {
    const tx = readAcceptedTransaction(row.signedCbor);

    expect(tx.id).toBe(row.txId);
    expect(tx.valid).toBe(true);
    expect(ids).not.toContain(tx.id);
    expect(tx.inputs.map(refId)).toContain(
      refId({ ...row.target, index: BigInt(row.target.index) }),
    );
    expect(fixture.checkpoints[row.checkpoint]).toBeDefined();
  }

  expect(ids).not.toContain(fixture.effects.txId);
  expect(fixture.effects).toMatchObject({
    layer: "wallet_effects",
    approvalRejected: true,
    signed: false,
    nodeSubmissionAttempted: false,
  });
});

it.each(cases)("preserves intended real-node failure boundaries for $label", ({ fixture }) => {
  for (const control of fixture.controls) {
    expect(readAcceptedTransaction(control.signedCbor).id).toBe(control.txId);
    expect(evaluated(control.evaluation)).not.toHaveLength(0);
  }

  for (const row of fixture.rejected) {
    const submission = row.submission as RpcReply;

    if ("evaluation" in row) {
      const evaluation = row.evaluation as RpcReply;

      if (row.label === "missing-pause-witness") {
        evaluated(evaluation);
        expect(submission.error?.code).toBe(3101);
        expect(submission.error?.data).toEqual({
          missingSignatories: [
            fixture.checkpoints[row.checkpoint]?.response.data.snapshot.terms.pauseKey,
          ],
        });
      } else {
        const errors = compiledFailure(evaluation);
        const tx = readAcceptedTransaction(row.signedCbor);
        const pointer = tx.inputs.findIndex(
          (ref) => refId(ref) === refId({ ...row.target, index: BigInt(row.target.index) }),
        );

        expect(
          errors.some(
            (error) => error.validator.purpose === "spend" && error.validator.index === pointer,
          ),
        ).toBe(true);
        expect(submission.error?.code).toBe(3136);
      }

      expect(fixture.controls.some((control) => control.txId === row.controlTxId)).toBe(true);
    } else {
      expect(row.label).toMatch(/^spent-(state|request|claim)$/);
      expect([3117, 3997]).toContain(submission.error?.code);

      if (submission.error?.code === 3997)
        expect(submission.error.data).toEqual({
          error: "All inputs are spent. Transaction has probably already been included",
        });
      else
        expect(submission.error?.data).toMatchObject({
          unknownOutputReferences: expect.arrayContaining([
            { transaction: { id: row.target.txId }, index: Number(row.target.index) },
          ]),
        });
    }
  }
});

it.each(cases)(
  "replays every full $label combined response at its recorded basis",
  ({ fixture }) => {
    for (const checkpoint of fixture.checkpoints) {
      const request = decodeReadRequest(checkpoint.request);
      const response = decodeQueryResponse(
        checkpoint.response,
        request.queries,
        fixture.expected.policy,
        fixture.network as NetworkBinding,
      );
      const reader = at(fixture, response.basis.chainPoint.blockHash);

      expect(dispatchRead(reader, fixture.expected.policy, request, response.basis)).toEqual(
        response,
      );

      for (const method of ECONOMIC_METHODS)
        expect((response.data as Record<keyof ReadQueries, unknown>)[method]).toBeDefined();
    }
  },
);

it.each(cases)(
  "retains exact $label accounting and public results through restart",
  ({ fixture }) => {
    const before = fixture.checkpoints[fixture.expected.restartBefore]?.response;
    const final = fixture.checkpoints[fixture.expected.finalCheckpoint]?.response;

    assert.ok(before && final);
    expect(final.data.snapshot.state).toMatchObject(fixture.expected.state);
    expect(final.data).toEqual(before.data);
    expect(final.basis.instance).not.toBe(before.basis.instance);
    expect(final.basis.stateRef).toEqual(before.basis.stateRef);
    expect(final.basis.chainPoint).toEqual(before.basis.chainPoint);

    if ("request" in final.data) expect(final.data.request.status).toBe("delivered");

    if ("claim" in final.data) expect(final.data.claim.unspent).toBe(false);
  },
);
