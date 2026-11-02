/** SDK-07 async acceptance: real Conway ledger, original accepted CBOR and corroborating CLI readback. */
import assert from "node:assert/strict";
import { buildGenesisPlan } from "@ctvs/ctvs2";
import { createIndexerClient } from "@ctvs/integration/client";
import { ECONOMIC_METHODS } from "@ctvs/integration/query";
import { expect, it } from "vitest";
import { asRef } from "../../../../../../testing/ledger/serialization.js";
import { economicQueries, economicUnits, nativeInventory } from "../../support/assets.js";
import { eventually, queryUrl, write } from "../../support/environment.js";
import { type NodeFixture, withNode } from "../../support/fixture.js";
import { execute, type Flow, peer, receipts, synced } from "../../support/flow.js";
import { freeze, primary } from "../../support/fork.js";
import { install, type Underlying } from "../../support/install.js";
import { lookupReady } from "../../support/lookup.js";
import { statelessRead } from "../../support/persistence.js";
import { wallet } from "../../support/wallet.js";
import { lifecycle } from "./async-lifecycle.js";
import { recovery } from "./async-recovery.js";

async function initialView(f: Flow) {
  const initial = await f.vault.read(economicQueries);

  for (const method of ECONOMIC_METHODS) economicUnits(f, initial.data[method]);

  expect(initial.data.previewDeposit.pricing).toBe("indicative_until_settlement");
  expect(initial.data.previewDeposit.result).toEqual({ status: "known", value: 100000000n });
  expect(initial.data.previewMint.capabilities.execution).toBe("unsupported");
  expect(initial.data.previewWithdraw.capabilities.execution).toBe("unsupported");
  write(f.env.directory, "initial-sdk", initial);

  return initial;
}

async function run(fixture: NodeFixture, underlying: Underlying) {
  const { env, capture } = fixture;

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
    const vault = createIndexerClient({
      baseUrl: queryUrl,
      expectedNetwork: env.config.network,
    }).vault(installed.deployment.policy);
    const f: Flow = { env, w, installed, vault, receipts: [...installed.receipts] };
    const deployment = installed.deployment;

    assert.equal(deployment.family, "ctvs2");

    if (deployment.family !== "ctvs2") throw new Error("wrong family");

    const genesis = await execute(
      f,
      "genesis",
      buildGenesisPlan({
        deployment,
        terms: installed.terms,
        seed: asRef(installed.seed),
        configReserve: 10000000n,
        stateReserve: 10000000n,
      }),
    );

    await synced(
      () => vault.snapshot(),
      (value) => value.data.state.sequence === 0n,
      "authenticated genesis",
    );

    const actor = await peer(f);

    expect(actor.hash).not.toBe(installed.terms.pauseKey);

    const initial = await initialView(f);

    const deposited = await lifecycle(f, actor, "deposit");

    expect(deposited.data.snapshot.state.backingAssets).toBe(100000000n);
    expect(deposited.data.snapshot.state.economicSupply).toBe(100000000n);
    expect(deposited.data.snapshot.state.accruedFees).toBe(1000000n);

    const redeemed = await lifecycle(f, actor, "redeem");

    expect(redeemed.data.snapshot.state.backingAssets).toBe(90000000n);
    expect(redeemed.data.snapshot.state.economicSupply).toBe(90000000n);
    expect(redeemed.data.snapshot.state.accruedFees).toBe(1099010n);
    await recovery(f, actor);
    expect((await vault.snapshot()).data.state).toEqual(redeemed.data.snapshot.state);
    await receipts(f, chain);
    await freeze(primary(env));

    const final = await statelessRead(
      f,
      {
        ...economicQueries,
        snapshot: true,
        context: true,
        ownership: { address: installed.receiver.address },
        request: { ref: redeemed.data.request.ref },
        claim: { ref: redeemed.data.claim.ref },
      },
      "ctvs2-final",
    );

    await expect(
      vault.read({ snapshot: true }, { expectedBasis: initial.basis }),
    ).rejects.toMatchObject({ code: "STALE_BASIS" });

    const status = await lookupReady(env, "ctvs2-final");

    expect(status.lookupReady).toBe(true);
    await nativeInventory(f);
    write(env.directory, "ctvs2-result", {
      passed: true,
      network: env.config.network,
      bootstrap: env.config.intersection,
      deployment,
      underlying: installed.terms.underlying,
      genesis: genesis.txId,
      stages: f.receipts.map((record) => ({
        stage: record.stage,
        txId: record.txId,
        bytes: record.bytes,
        evaluations: record.evaluations,
      })),
      deposited,
      redeemed,
      final,
      status,
      limits: w.parameters,
      coverage: [
        "deposit and redemption Requests",
        "settlement",
        "delivery",
        "cancellation",
        "expiry",
      ],
    });
  } finally {
    await chain.close();
  }
}

it.each(["ada", "native"] as const)(
  "accepts SDK-planned CTVS-2 %s requests, settlement, delivery, cancellation and expiry",
  async (underlying) => {
    return withNode(
      { family: "ctvs2", directory: process.env.CTVS_INDEXER_NODE_DIR },
      async (fixture) => {
        await run(fixture, underlying);
      },
    );
  },
  180000,
);
