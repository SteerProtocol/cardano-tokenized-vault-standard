/** Require actual inclusion of a script-invalid body and only its collateral effects. */
import assert from "node:assert/strict";
import { readAcceptedTransaction } from "@ctvs/integration";
import { refId } from "@ctvs/protocol";
import { expect } from "vitest";
import { protocolValue } from "../../../../../../testing/ledger/serialization.js";
import { eventually, write } from "../../support/environment.js";
import type { Flow } from "../../support/flow.js";
import { forge, primary } from "../../support/fork.js";
import { statelessRead } from "../../support/persistence.js";
import { nodeRpc } from "../../support/rpc.js";
import type { maintenanceRead } from "../maintenance/maintenance.js";
import type { Actor } from "../rejections/rejection-common.js";
import { rejectionPoint } from "../rejections/rejection-control.js";
import { collateralSource, invalidCandidate } from "./g1-collateral.js";
import { g1Ledger } from "./g1-ledger.js";

export async function includedInvalid(
  f: Flow,
  actor: Actor,
  requested: ReturnType<typeof maintenanceRead>,
) {
  forge(primary(f.env));

  const source = await collateralSource(f);
  const before = await rejectionPoint(f, requested, "g1-before-invalid");
  const candidate = await invalidCandidate(f, actor, source);
  const ordinary = readAcceptedTransaction(candidate.validCbor);
  const preserved = [...ordinary.inputs, ...ordinary.referenceInputs];
  const previous = g1Ledger(f, preserved);
  const returnRef = { txId: candidate.txId, index: BigInt(ordinary.outputs.length) };
  const expected = {
    ...protocolValue(source.assets),
    ada: (source.assets.lovelace ?? 0n) - 5000000n,
  };

  write(f.env.directory, "g1-invalid-candidate", { ...candidate, returnRef, expected, previous });

  const submission = await nodeRpc(f, "submitTransaction", candidate.signedCbor);

  write(f.env.directory, "g1-invalid-submission", submission);
  expect(submission.error).toBeUndefined();
  expect(submission.result).toEqual({ transaction: { id: candidate.txId } });
  forge(primary(f.env));
  await eventually(
    async () =>
      (
        await f.w.provider.getUtxosByOutRef([
          { txHash: returnRef.txId, outputIndex: Number(returnRef.index) },
        ])
      ).length
        ? true
        : undefined,
    "script-invalid collateral return inclusion",
  );

  const after = await rejectionPoint(f, requested, "g1-after-invalid");

  expect(after.data.snapshot.state).toEqual(before.data.snapshot.state);
  expect(after.basis.stateRef).toEqual(before.basis.stateRef);
  expect(after.data.ownership.freeShares).toBe(before.data.ownership.freeShares - 1000000n);
  expect(g1Ledger(f, preserved)).toEqual(previous);
  expect(g1Ledger(f, [{ txId: source.txHash, index: BigInt(source.outputIndex) }]).values).toEqual(
    {},
  );
  expect(g1Ledger(f, [returnRef]).values).toEqual({
    [refId(returnRef)]: { address: actor.address, value: expected },
  });

  const absent = ordinary.outputs.map((output) => output.ref);

  expect(g1Ledger(f, absent).values).toEqual({});
  expect(
    await f.w.provider.getUtxosByOutRef(
      absent.map((ref) => ({ txHash: ref.txId, outputIndex: Number(ref.index) })),
    ),
  ).toEqual([]);

  const [returned] = await f.w.provider.getUtxosByOutRef([
    { txHash: returnRef.txId, outputIndex: Number(returnRef.index) },
  ]);

  assert.ok(returned);
  expect(protocolValue(returned.assets)).toEqual(expected);

  const actorResponse = await statelessRead(
    f,
    {
      ...requested,
      ownership: { address: { payment: { type: "key", hash: actor.hash }, stake: null } },
    },
    "g1-actor-after-invalid",
  );

  expect(actorResponse.basis).toEqual(after.basis);
  expect(actorResponse.data.ownership.freeShares).toBe(1000000n);
  write(f.env.directory, "g1-included-invalid", {
    ...candidate,
    submission,
    returnRef,
    expected,
    before,
    after,
    actorResponse,
    previous,
    returned,
    actualCliReturn: g1Ledger(f, [returnRef]),
    collateralOnly: true,
  });

  return { candidate, before, after, returnRef };
}
