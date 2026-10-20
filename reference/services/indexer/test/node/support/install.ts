/** Publish compiled family programs and real native fixture assets on the disposable ledger. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { Deployment } from "@ctvs/planning";
import * as p from "@ctvs/protocol";
import {
  applyParamsToScript,
  Data,
  getAddressDetails,
  type Script,
  scriptFromNative,
  validatorToScriptHash,
} from "@lucid-evolution/lucid";
import { expect } from "vitest";
import { asRef, datumHex } from "../../../../../testing/ledger/serialization.js";
import type { environment } from "./environment.js";
import { write } from "./environment.js";
import { submit, type wallet } from "./wallet.js";

export function claimProgram(env: ReturnType<typeof environment>): Script {
  assert.ok(env.reviewed.claim);

  return env.reviewed.claim;
}

export type Underlying = "ada" | "native";

async function issueAssets(
  env: ReturnType<typeof environment>,
  w: Awaited<ReturnType<typeof wallet>>,
  underlying: Underlying = "ada",
) {
  const { lucid, provider } = w;
  const address = await lucid.wallet().address();
  const key = getAddressDetails(address).paymentCredential?.hash;

  assert.ok(key);

  const native = scriptFromNative({ type: "sig", keyHash: key });
  const unit = `${validatorToScriptHash(native)}474f53414645${randomBytes(4).toString("hex")}`;
  const underlyingUnit = `${validatorToScriptHash(native)}4e4154495645${randomBytes(4).toString("hex")}`;
  const amount = 9007199254740993n;
  const issued =
    underlying === "native" ? { [unit]: amount, [underlyingUnit]: amount } : { [unit]: amount };

  const quantity = await submit(
    env.directory,
    "safe-quantity",
    lucid
      .newTx()
      .mintAssets(issued)
      .attach.MintingPolicy(native)
      .pay.ToAddress(address, { lovelace: 10000000n, ...issued }),
    provider,
  );

  const actual = (await provider.getUtxoByUnit(unit)).assets[unit];

  expect(actual).toBe(amount);

  if (underlying === "native")
    expect((await provider.getUtxoByUnit(underlyingUnit)).assets[underlyingUnit]).toBe(amount);

  write(env.directory, "safe-quantity-readback", {
    unit,
    amount: actual,
    underlying,
    underlyingUnit: underlying === "native" ? underlyingUnit : null,
  });

  return { address, key, unit, underlyingUnit, quantity };
}

export async function install(
  env: ReturnType<typeof environment>,
  w: Awaited<ReturnType<typeof wallet>>,
  underlying: Underlying = "ada",
) {
  const { lucid, provider } = w;
  const { address, key, unit, underlyingUnit, quantity } = await issueAssets(env, w, underlying);

  const funds = await lucid.wallet().getUtxos();
  const seed = funds.find(
    (utxo) => utxo.outputIndex === 0 && Object.keys(utxo.assets).length === 1,
  );

  assert.ok(seed);

  const publisher = funds.find(
    (utxo) =>
      utxo !== seed &&
      Object.keys(utxo.assets).length === 1 &&
      (utxo.assets.lovelace ?? 0n) > 100000000n,
  );

  assert.ok(publisher);

  const receiver = { address: p.enterprise(key, "key"), datum: null };
  const terms: p.Terms = {
    profile: 0n,
    networkDomain: env.config.network.domain,
    underlying:
      underlying === "native"
        ? { policy: underlyingUnit.slice(0, 56), name: underlyingUnit.slice(56) }
        : "ada",
    virtualShares: 1n,
    maxBacking: null,
    entryBps: 100n,
    exitBps: 100n,
    feeDestination: receiver,
    pauseKey: key,
    settlers: null,
    executionModes: env.reviewed.family === "ctvs1" ? 3n : 12n,
    maxBatch: 16n,
    descriptorHash: null,
  };
  const termsHash = p.termsHash(terms);
  const vault: Script = {
    type: "PlutusV3",
    script: applyParamsToScript(env.reviewed.vaultTemplate, [
      Data.from<Data>(datumHex(p.outRefData(asRef(seed)))),
      termsHash,
    ]),
  };
  const base = {
    network: env.config.network.name,
    networkDomain: terms.networkDomain,
    policy: validatorToScriptHash(vault),
    configLock: validatorToScriptHash(env.reviewed.config),
    termsHash,
    configRef: asRef(seed),
    buildId: env.reviewed.buildId,
    chainPoint: env.config.intersection,
  };
  const deployment: Deployment =
    env.reviewed.family === "ctvs1"
      ? { ...base, family: "ctvs1", claimScript: null }
      : { ...base, family: "ctvs2", claimScript: validatorToScriptHash(claimProgram(env)) };
  const publication = await submit(
    env.directory,
    "publication",
    lucid
      .newTx()
      .collectFrom([publisher])
      .pay.ToAddressWithData(address, undefined, { lovelace: 100000000n }, vault),
    provider,
  );
  const reference = (
    await provider.getUtxosByOutRef([{ txHash: publication.txId, outputIndex: 0 }])
  )[0];

  assert.ok(reference);
  expect(
    await provider.getUtxosByOutRef([{ txHash: seed.txHash, outputIndex: seed.outputIndex }]),
  ).toHaveLength(1);

  return { terms, deployment, seed, reference, receiver, unit, receipts: [quantity, publication] };
}
