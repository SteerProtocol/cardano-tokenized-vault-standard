/** The failed transaction returns real token-bearing collateral to a second generated key. */
import assert from "node:assert/strict";
import { readAcceptedTransaction } from "@ctvs/integration";
import { NAMES } from "@ctvs/protocol";
import { expect } from "vitest";
import { compiledFailure, evaluated } from "../../../support/evidence/rpc.js";
import type { Flow } from "../../support/flow.js";
import { nodeRpc } from "../../support/rpc.js";
import { submit } from "../../support/wallet.js";
import { negativeCandidate } from "../rejections/rejection-candidate.js";
import type { Actor } from "../rejections/rejection-common.js";
import { pausePlan } from "../rejections/rejection-control.js";
import { collateralBody, scriptInvalid } from "./g1-invalid-body.js";

export async function collateralSource(f: Flow) {
  f.w.selectOwner();

  const assets = {
    lovelace: 50000000n,
    [`${f.installed.deployment.policy}${NAMES.share}`]: 1000000n,
    [f.installed.unit]: 9007199254740993n,
    ...(f.installed.terms.underlying === "ada"
      ? {}
      : {
          [`${f.installed.terms.underlying.policy}${f.installed.terms.underlying.name}`]: 4321n,
        }),
  };
  const receipt = await submit(
    f.env.directory,
    "g1-collateral-source",
    f.w.lucid.newTx().pay.ToAddress(await f.w.lucid.wallet().address(), assets),
    f.w.provider,
  );

  f.receipts.push(receipt);

  const [source] = await f.w.provider.getUtxosByOutRef([{ txHash: receipt.txId, outputIndex: 0 }]);

  assert.ok(source);
  expect(source.assets).toEqual(assets);

  return source;
}

export async function invalidCandidate(
  f: Flow,
  actor: Actor,
  source: Awaited<ReturnType<typeof collateralSource>>,
) {
  f.w.selectOwner();

  const funds = await f.w.lucid.wallet().getUtxos();

  f.w.lucid.overrideUTxOs(
    funds.filter(
      (utxo) => utxo.txHash !== source.txHash || utxo.outputIndex !== source.outputIndex,
    ),
  );

  try {
    const control = await pausePlan(f, 3n);
    const good = await negativeCandidate(f, "g1-pause-control", control);
    const controlEvaluation = await nodeRpc(f, "evaluateTransaction", good.signedCbor);

    evaluated(controlEvaluation);

    const bad = structuredClone(control);

    bad.requiredSigners = [];

    const proposed = await negativeCandidate(f, "g1-invalid-intent", bad);
    const built = await f.w.lucid
      .fromTx(collateralBody(proposed.signedCbor, source, actor.address))
      .sign.withWallet()
      .complete();
    const validCbor = built.toCBOR();
    const evaluation = await nodeRpc(f, "evaluateTransaction", validCbor);

    compiledFailure(evaluation);

    const rejection = await nodeRpc(f, "submitTransaction", validCbor);

    expect(rejection.error?.code).toBe(3136);

    const signedCbor = scriptInvalid(validCbor);

    expect(readAcceptedTransaction(signedCbor).id).toBe(built.toHash());
    expect(readAcceptedTransaction(signedCbor).valid).toBe(false);

    return {
      txId: built.toHash(),
      signedCbor,
      validCbor,
      evaluation,
      rejection,
      controlEvaluation,
      source,
    };
  } finally {
    f.w.lucid.clearUTxOOverride();
  }
}
