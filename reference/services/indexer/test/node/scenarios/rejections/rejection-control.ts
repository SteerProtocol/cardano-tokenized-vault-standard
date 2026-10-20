/** Accepted controls retain ordinary wallet approval and real remote evaluation/submission. */
import assert from "node:assert/strict";
import * as one from "@ctvs/ctvs1";
import * as two from "@ctvs/ctvs2";
import { toPlannerContext } from "@ctvs/integration";
import type { ReadQueries } from "@ctvs/integration/query";
import type { TransactionPlan } from "@ctvs/planning";
import { CML, withCMLScope } from "@lucid-evolution/lucid";
import { expect } from "vitest";
import { execute, type Flow, synced, validity } from "../../support/flow.js";
import { forge, freeze, primary, tip } from "../../support/fork.js";
import { statelessRead } from "../../support/persistence.js";
import { submit } from "../../support/wallet.js";

export function rejectionValidity(f: Flow) {
  const slots = f.w.lucid.config().slotConfig;

  assert.ok(slots);

  return {
    lowerPosixMs:
      BigInt(slots.zeroTime) +
      (BigInt(tip(primary(f.env)).slot) - 1n - BigInt(slots.zeroSlot)) * BigInt(slots.slotLength),
    upperPosixMs: validity(f.w).upperPosixMs + 60000n,
  };
}

export async function rejectionPoint<Q extends ReadQueries>(f: Flow, requested: Q, label: string) {
  const selected = await freeze(primary(f.env));

  await synced(
    () => f.vault.read(requested),
    (response) => response.basis.chainPoint.blockHash === selected.hash,
    label,
  );

  return statelessRead(f, requested, label);
}

export async function pausePlan(f: Flow, flags: bigint) {
  const raw = (await f.vault.context()).data;

  return raw.deployment.family === "ctvs1"
    ? one.buildSetPausePlan({ ...toPlannerContext(raw, "ctvs1"), pauseFlags: flags })
    : two.buildSetPausePlan({ ...toPlannerContext(raw, "ctvs2"), pauseFlags: flags });
}

export async function feePlan(f: Flow) {
  const raw = (await f.vault.context()).data;

  return raw.deployment.family === "ctvs1"
    ? one.buildCollectFeesPlan({ ...toPlannerContext(raw, "ctvs1"), receiverTopup: 2000000n })
    : two.buildCollectFeesPlan({ ...toPlannerContext(raw, "ctvs2"), receiverTopup: 2000000n });
}

export async function acceptControl(
  f: Flow,
  requested: ReadQueries,
  label: string,
  plan: TransactionPlan,
  select = f.w.selectOwner,
) {
  select();
  forge(primary(f.env));

  const before = await f.vault.read(requested);
  const receipt = await execute(f, label, plan);
  const selected = await freeze(primary(f.env));

  await synced(
    () => f.vault.read(requested),
    (response) => response.basis.chainPoint.blockHash === selected.hash,
    label,
  );

  const after = await statelessRead(f, requested, label);

  expect(after.basis.chainPoint.blockHash).toBe(selected.hash);
  await expect(f.vault.read(requested, { expectedBasis: before.basis })).rejects.toMatchObject({
    code: "STALE_BASIS",
  });

  return { receipt, after };
}

export async function withdrawalAccount(f: Flow) {
  const key = f.installed.terms.pauseKey;

  assert.ok(key);

  const address = withCMLScope((own) =>
    own(
      CML.RewardAddress.new(
        0,
        own(CML.Credential.new_pub_key(own(CML.Ed25519KeyHash.from_hex(key)))),
      ),
    )
      .to_address()
      .to_bech32(),
  );

  f.w.selectOwner();
  forge(primary(f.env));
  f.receipts.push(
    await submit(
      f.env.directory,
      "register-rejection-stake-key",
      f.w.lucid.newTx().registerAndDelegate.ToDRep(address, { __typename: "AlwaysAbstain" }),
      f.w.provider,
    ),
  );

  return address;
}
