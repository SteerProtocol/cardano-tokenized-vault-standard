/** Real source interruptions retain one daemon instance and require a negotiated intersection before queries resume. */
import assert from "node:assert/strict";
import { expect } from "vitest";
import { negotiation } from "../../../support/evidence/ogmios-wire.js";
import { eventually, journalSnapshot, queryUrl, write } from "../../support/environment.js";
import { execute, type Flow } from "../../support/flow.js";
import { adopt, checkpoint, type ForkNode, forge, freeze, primary } from "../../support/fork.js";
import { lookupReady, status } from "../../support/lookup.js";
import { statelessRead } from "../../support/persistence.js";
import type { maintenanceRead } from "../maintenance/maintenance.js";
import { pausePlan } from "../rejections/rejection-control.js";
import type { G1Relay } from "./g1-relay.js";

type Requested = ReturnType<typeof maintenanceRead>;

async function hold(f: Flow, relay: G1Relay, requested: Requested, label: string) {
  const response = await statelessRead(f, requested, `${label}-before`);
  const journal = journalSnapshot(f.env);
  const sessions = relay.sessions.length;

  relay.block();

  const disconnected = await eventually(async () => {
    const current = await status();

    return current.phase === "disconnected" ? current : undefined;
  }, "reader observes G1 source outage");

  expect(disconnected.readerReady).toBe(false);
  expect(disconnected.lookupReady).toBe(false);
  expect((await fetch(`${queryUrl}/health/live`)).ok).toBe(true);
  await expect(f.vault.read(requested)).rejects.toMatchObject({ code: "READER_NOT_READY" });
  expect(journalSnapshot(f.env)).toEqual(journal);
  write(f.env.directory, `${label}-outage`, { response, journal, disconnected });

  return { response, journal, sessions };
}

async function resume(
  f: Flow,
  relay: G1Relay,
  requested: Requested,
  label: string,
  before: Awaited<ReturnType<typeof hold>>,
  selected: { slot: bigint; blockHash: string },
  target: string,
) {
  relay.resume();
  await eventually(async () => {
    const current = await status();

    return current.readerReady && current.readerHead.blockHash === target ? current : undefined;
  }, "reader resumes from real common intersection");

  const after = await statelessRead(f, requested, `${label}-after`);

  expect(after.basis.instance).toBe(before.response.basis.instance);
  expect(after.basis.recoveryGeneration).toBeGreaterThan(before.response.basis.recoveryGeneration);
  await expect(
    f.vault.read(requested, { expectedBasis: before.response.basis }),
  ).rejects.toMatchObject({ code: "STALE_BASIS" });

  const session = relay.sessions
    .slice(before.sessions)
    .find((row) =>
      row.messages.some(
        (message) => message.direction === "response" && message.wire.includes('"intersection"'),
      ),
    );

  assert.ok(session);

  const actual = negotiation(session);
  const offered = [
    ...before.journal.blocks
      .slice(-32)
      .reverse()
      .map((block) => ({ slot: Number(block.point.slot), id: block.point.blockHash })),
    { slot: Number(f.env.config.intersection.slot), id: f.env.config.intersection.blockHash },
  ];

  expect(actual.proposed.params?.points).toEqual(offered);
  expect(actual.response.result?.intersection).toEqual({
    slot: Number(selected.slot),
    id: selected.blockHash,
  });
  write(f.env.directory, label, {
    before: before.response,
    after,
    negotiation: actual,
    session: session.id,
  });

  return after;
}

export async function reconnects(
  f: Flow,
  relay: G1Relay,
  requested: Requested,
  copies: ForkNode[],
) {
  const same = await hold(f, relay, requested, "g1-same-head");
  const sameAfter = await resume(
    f,
    relay,
    requested,
    "g1-same-head",
    same,
    same.response.basis.chainPoint,
    same.response.basis.chainPoint.blockHash,
  );

  expect(sameAfter.data).toEqual(same.response.data);
  await lookupReady(f.env, "g1-same-head");

  const saved = await checkpoint(f.env, "g1-standby", copies);
  const plan = await pausePlan(f, 1n);
  const catchup = await hold(f, relay, requested, "g1-catchup");

  forge(primary(f.env));
  f.w.selectOwner();

  const accepted = await execute(f, "g1-offline-pause", plan);
  const advanced = await freeze(primary(f.env));

  expect(journalSnapshot(f.env)).toEqual(catchup.journal);

  const caughtUp = await resume(
    f,
    relay,
    requested,
    "g1-catchup",
    catchup,
    catchup.response.basis.chainPoint,
    advanced.hash,
  );

  expect(caughtUp.basis.stateRef.txId).toBe(accepted.txId);
  expect(caughtUp.data.snapshot.state.pauseFlags).toBe(1n);
  await lookupReady(f.env, "g1-catchup");

  const fork = await hold(f, relay, requested, "g1-fork-reconnect");

  f.env.compose("stop", "kupo");

  try {
    const replacement = await adopt(f.env, saved.node, "g1-reconnect-fork");

    expect(journalSnapshot(f.env)).toEqual(fork.journal);

    const restored = await resume(
      f,
      relay,
      requested,
      "g1-fork-reconnect",
      fork,
      saved.common,
      replacement.hash,
    );

    expect((await status()).lookupReady).toBe(false);
    expect(restored.basis.stateRef).toEqual(sameAfter.basis.stateRef);
    expect(restored.data.snapshot.state).toEqual(sameAfter.data.snapshot.state);
    expect(restored.data.ownership).toEqual(sameAfter.data.ownership);

    return { sameAfter, caughtUp, restored, orphan: accepted.txId, common: saved.common };
  } finally {
    f.env.compose("up", "-d", "--no-deps", "kupo");
    await lookupReady(f.env, "g1-fork-reconnect");
  }
}
