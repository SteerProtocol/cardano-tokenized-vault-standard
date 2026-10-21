/** G0 and SDK-07 CTVS-1: actual Conway inclusion, HTTP planner handoff and independently queried outputs. */
import assert from "node:assert/strict";
import { buildDirectPlan, buildGenesisPlan } from "@ctvs/ctvs1";
import { readAcceptedTransaction, toPlannerContext } from "@ctvs/integration";
import { createIndexerClient } from "@ctvs/integration/client";
import * as p from "@ctvs/protocol";
import { expect, it } from "vitest";
import { constructPlan } from "../../../../../../testing/ledger/builder.js";
import { asRef, protocolValue } from "../../../../../../testing/ledger/serialization.js";
import {
  docker,
  type environment,
  eventually,
  nodeImage,
  queryUrl,
  write,
} from "../../support/environment.js";
import { type NodeFixture, withNode } from "../../support/fixture.js";
import { install, type Underlying } from "../../support/install.js";
import { lookupReady } from "../../support/lookup.js";
import { authorize, submit, wallet } from "../../support/wallet.js";
import { directLifecycle } from "./direct-lifecycle.js";

type Env = ReturnType<typeof environment>;
type Wallet = Awaited<ReturnType<typeof wallet>>;
type Installed = Awaited<ReturnType<typeof install>>;
type VaultHandle = ReturnType<ReturnType<typeof createIndexerClient>["vault"]>;

async function deployGenesis(env: Env, w: Wallet, installed: Installed, vault: VaultHandle) {
  const { deployment, terms, seed, reference } = installed;

  assert.equal(deployment.family, "ctvs1");

  if (deployment.family !== "ctvs1") throw new Error("wrong family");

  const genesis = buildGenesisPlan({
    deployment,
    terms,
    seed: asRef(seed),
    configReserve: 10000000n,
    stateReserve: 10000000n,
  });
  const acceptedGenesis = await submit(
    env.directory,
    "genesis",
    await constructPlan(w.lucid, w.provider, { vaultReference: reference, claim: null }, genesis),
    w.provider,
    {
      plan: genesis,
      authorization: await authorize(w.lucid, w.provider, deployment, genesis, reference),
    },
  );

  await eventually(async () => {
    const status = await fetch(`${queryUrl}/health/ready`);

    if (!status.ok) return undefined;

    try {
      return await vault.snapshot();
    } catch (error) {
      if (error instanceof Error && error.message.includes("genesis")) return undefined;

      throw error;
    }
  }, "authenticated genesis");

  return acceptedGenesis;
}

async function readDeposited(vault: VaultHandle, address: p.Address) {
  return eventually(async () => {
    const status = await fetch(`${queryUrl}/health/ready`);

    if (!status.ok) return undefined;

    const response = await vault.read({
      snapshot: true,
      ownership: { address },
      context: true,
    });

    return response.data.snapshot.state.sequence === 1n ? response : undefined;
  }, "deposited State through SDK");
}

async function verifyReadback(
  env: Env,
  w: Wallet,
  after: Awaited<ReturnType<typeof readDeposited>>,
  acceptedDeposit: Awaited<ReturnType<typeof submit>>,
) {
  const independent = JSON.parse(
    env.cli(
      "conway",
      "query",
      "utxo",
      "--tx-in",
      `${acceptedDeposit.txId}#0`,
      "--testnet-magic",
      "42",
      "--socket-path",
      "/ipc/node.socket",
      "--out-file",
      "/dev/stdout",
    ),
  );

  write(env.directory, "node-ledger-readback", independent);

  const state = (
    await w.provider.getUtxosByOutRef([{ txHash: acceptedDeposit.txId, outputIndex: 0 }])
  )[0];

  assert.ok(state);
  expect(protocolValue(state.assets)).toEqual(after.data.context.stateInput.value);
  expect(state.datum).toBe(after.data.context.stateInput.datumCbor);
  expect(Object.keys(independent)).toEqual([`${acceptedDeposit.txId}#0`]);

  const row = independent[`${acceptedDeposit.txId}#0`];

  expect(row.address).toBe(state.address);
  expect(row.inlineDatumRaw).toBe(after.data.context.stateInput.datumCbor);
  expect(p.stateFromData(p.decodeData(row.inlineDatumRaw))).toEqual(after.data.snapshot.state);
  expect(row.referenceScript).toBeNull();

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

  expect(value).toEqual(after.data.context.stateInput.value);
}

async function runG0(fixture: NodeFixture, underlying: Underlying) {
  const { env, capture } = fixture;
  const nodeVersion = docker(["exec", `${env.project}-node-1`, "cardano-node", "--version"]);

  assert.match(nodeVersion, /11\.0\.1/);
  env.compose("up", "-d", "--no-build", "indexer");

  const chain = await capture();

  try {
    await eventually(
      async () =>
        (await fetch(`${queryUrl}/health/ready`).catch(() => null))?.ok ? true : undefined,
      "reader readiness",
    );

    const w = await wallet(env);
    const installed = await install(env, w, underlying);
    const { deployment, reference, receiver } = installed;
    const client = createIndexerClient({ baseUrl: queryUrl, expectedNetwork: env.config.network });
    const vault = client.vault(deployment.policy);

    await expect(vault.snapshot()).rejects.toMatchObject({ code: "HISTORY_INCOMPLETE" });

    const acceptedGenesis = await deployGenesis(env, w, installed, vault);

    const before = await vault.read({
      snapshot: true,
      previewDeposit: { assets: 101000000n, include: ["construction"] },
    });
    const construction = before.data.previewDeposit.construction;

    assert.ok(construction);
    expect(before.data.previewDeposit.result).toEqual({ status: "known", value: 100000000n });

    const context = toPlannerContext(construction, "ctvs1");
    const deposit = buildDirectPlan({
      ...context,
      operation: "deposit",
      amount: 101000000n,
      bound: 100000000n,
      receiver,
      receiverTopup: 2000000n,
    });
    const acceptedDeposit = await submit(
      env.directory,
      "deposit",
      await constructPlan(w.lucid, w.provider, { vaultReference: reference, claim: null }, deposit),
      w.provider,
      {
        plan: deposit,
        authorization: await authorize(w.lucid, w.provider, context.deployment, deposit, reference),
      },
    );
    const after = await readDeposited(vault, receiver.address);

    expect(after.data.snapshot.state.backingAssets).toBe(100000000n);
    expect(after.data.snapshot.state.economicSupply).toBe(100000000n);
    expect(after.data.snapshot.state.accruedFees).toBe(1000000n);
    expect(after.data.ownership.freeShares).toBe(100000000n);
    expect(after.data.context.stateInput.ref.txId).toBe(acceptedDeposit.txId);

    for (const record of [acceptedGenesis, acceptedDeposit]) {
      const observed = await eventually(
        async () => chain.observed.get(record.txId),
        "accepted chain bytes",
      );

      expect(readAcceptedTransaction(observed.cbor).id).toBe(record.txId);
      expect(observed.slot).toBeGreaterThan(env.config.intersection.slot);
      write(env.directory, `${record.stage}-receipt`, {
        ...record,
        ...observed,
        nodeAccepted: true,
      });
    }

    await verifyReadback(env, w, after, acceptedDeposit);
    expect(chain.failures).toEqual([]);

    const status = await lookupReady(env, "g0-final");

    expect(status.lookupReady).toBe(true);
    write(env.directory, "g0-result", {
      passed: true,
      nodeImage,
      nodeVersion,
      network: env.config.network,
      bootstrap: env.config.intersection,
      deployment: context.deployment,
      underlying: installed.terms.underlying,
      genesis: acceptedGenesis.txId,
      deposit: acceptedDeposit.txId,
      response: after,
      status,
      limits: w.parameters,
      nodeAcceptance: `CTVS-1 ${underlying} genesis and direct deposit`,
      coverage: ["genesis", "initial direct deposit"],
    });
    await directLifecycle({ env, w, installed, vault, receipts: [] }, chain);
  } finally {
    await chain.close();
  }
}

it.each(["ada", "native"] as const)(
  "accepts CTVS-1 %s genesis and SDK-planned deposit, mint, withdraw and redeem",
  async (underlying) => {
    return withNode({ directory: process.env.CTVS_INDEXER_NODE_DIR }, async (fixture) => {
      await runG0(fixture, underlying);
    });
  },
  180000,
);
