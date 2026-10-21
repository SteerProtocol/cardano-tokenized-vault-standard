/** Small node-only helpers: SDK synchronization, exact output readback and approved plan execution. */
import assert from "node:assert/strict";
import { readAcceptedTransaction } from "@ctvs/integration";
import { type createIndexerClient, QueryError } from "@ctvs/integration/client";
import type { TransactionPlan } from "@ctvs/planning";
import type { OutRef } from "@ctvs/protocol";
import { generatePrivateKey, getAddressDetails, Lucid } from "@lucid-evolution/lucid";
import { expect } from "vitest";
import { constructPlan } from "../../../../../testing/ledger/builder.js";
import { protocolValue } from "../../../../../testing/ledger/serialization.js";
import type { capture } from "./capture.js";
import { type environment, eventually, queryUrl, write } from "./environment.js";
import { claimProgram, type install } from "./install.js";
import { authorize, submit, type wallet } from "./wallet.js";

export type Env = ReturnType<typeof environment>;
export type Wallet = Awaited<ReturnType<typeof wallet>>;
export type Installed = Awaited<ReturnType<typeof install>>;
export type Vault = ReturnType<ReturnType<typeof createIndexerClient>["vault"]>;
export type Receipt = Awaited<ReturnType<typeof submit>>;
export type Flow = { env: Env; w: Wallet; installed: Installed; vault: Vault; receipts: Receipt[] };

export function validity(w: Wallet) {
  const slots = w.lucid.config().slotConfig;

  assert.ok(slots);

  const now =
    Math.floor((Date.now() - slots.zeroTime) / slots.slotLength) * slots.slotLength +
    slots.zeroTime;

  return { lowerPosixMs: BigInt(now - 2000), upperPosixMs: BigInt(now + 60000) };
}

export async function synced<T>(
  read: () => Promise<T>,
  included: (value: T) => boolean,
  label: string,
) {
  return eventually(async () => {
    if (!(await fetch(`${queryUrl}/health/ready`).catch(() => null))?.ok) return undefined;

    try {
      const value = await read();

      return included(value) ? value : undefined;
    } catch (error) {
      if (
        error instanceof QueryError &&
        ["NOT_FOUND", "HISTORY_INCOMPLETE", "READER_NOT_READY"].includes(error.code)
      )
        return undefined;

      throw error;
    }
  }, label);
}

export async function execute(f: Flow, stage: string, plan: TransactionPlan) {
  const { env, w, installed } = f;
  const record = await submit(
    env.directory,
    stage,
    await constructPlan(
      w.lucid,
      w.provider,
      {
        vaultReference: installed.reference,
        claim: installed.deployment.family === "ctvs2" ? claimProgram(env) : null,
      },
      plan,
    ),
    w.provider,
    {
      plan,
      authorization: await authorize(
        w.lucid,
        w.provider,
        installed.deployment,
        plan,
        installed.reference,
      ),
    },
  );

  f.receipts.push(record);

  return record;
}

export async function peer(f: Flow) {
  const key = generatePrivateKey();
  const lucid = await Lucid(f.w.provider, "Custom");

  lucid.selectWallet.fromPrivateKey(key);

  const address = await lucid.wallet().address();
  const hash = getAddressDetails(address).paymentCredential?.hash;

  assert.ok(hash);
  f.receipts.push(
    await submit(
      f.env.directory,
      "peer-funding",
      f.w.lucid
        .newTx()
        .pay.ToAddress(address, { lovelace: 200000000n })
        .pay.ToAddress(address, { lovelace: 100000000n }),
      f.w.provider,
    ),
  );

  return { address, hash, select: () => f.w.lucid.selectWallet.fromPrivateKey(key) };
}

export async function readback(
  f: Flow,
  stage: string,
  ref: OutRef,
  expected?: { value: Record<string, bigint>; datumCbor: string | null },
) {
  const [utxo] = await f.w.provider.getUtxosByOutRef([
    { txHash: ref.txId, outputIndex: Number(ref.index) },
  ]);

  assert.ok(utxo);

  const ledger = JSON.parse(
    f.env.cli(
      "conway",
      "query",
      "utxo",
      "--tx-in",
      `${ref.txId}#${ref.index}`,
      "--testnet-magic",
      "42",
      "--socket-path",
      "/ipc/node.socket",
      "--out-file",
      "/dev/stdout",
    ),
  );
  const row = ledger[`${ref.txId}#${ref.index}`];

  assert.ok(row);
  expect(row.address).toBe(utxo.address);
  expect(row.inlineDatumRaw ?? null).toBe(utxo.datum ?? null);

  const value: Record<string, bigint> = {};

  for (const [policy, assets] of Object.entries(row.value)) {
    if (policy === "lovelace") {
      assert.ok(Number.isSafeInteger(assets));
      value.ada = BigInt(assets as number);
    } else
      for (const [name, amount] of Object.entries(assets as Record<string, number>)) {
        assert.ok(Number.isSafeInteger(amount));
        value[`${policy}.${name}`] = BigInt(amount);
      }
  }

  expect(value).toEqual(protocolValue(utxo.assets));

  if (expected) {
    expect(value).toEqual(expected.value);
    expect(utxo.datum ?? null).toBe(expected.datumCbor);
  }

  write(f.env.directory, `${stage}-readback`, { ref, ledger, provider: utxo, expected });

  return utxo;
}

export async function receipts(f: Flow, chain: Awaited<ReturnType<typeof capture>>) {
  for (const record of f.receipts) {
    const observed = await eventually(
      async () => chain.observed.get(record.txId),
      `${record.stage} accepted chain bytes`,
    );

    expect(observed.cbor).toBe(record.signedCbor);
    expect(readAcceptedTransaction(observed.cbor).id).toBe(record.txId);
    expect(observed.slot).toBeGreaterThan(f.env.config.intersection.slot);
    expect(record.bytes).toBeLessThanOrEqual(f.w.parameters.maxTxSize);
    write(f.env.directory, `${record.stage}-receipt`, {
      ...record,
      ...observed,
      nodeAccepted: true,
    });
  }

  expect(chain.failures).toEqual([]);
}
