/** Persistence belongs to the service. Old and freshly constructed HTTP clients carry no recovery state. */
import { dispatchRead, VaultReader } from "@ctvs/integration";
import { createIndexerClient } from "@ctvs/integration/client";
import { QUERY_VERSION, type QueryResponse, type ReadQueries } from "@ctvs/integration/query";
import { expect } from "vitest";
import { docker, eventually, journalSnapshot, queryUrl, write } from "./environment.js";
import { type Flow, synced } from "./flow.js";
import { lookupReady, status } from "./lookup.js";

export function economicRead(f: Flow) {
  return {
    snapshot: true as const,
    convertToAssets: { shares: 10000000n },
    convertToShares: { assets: 10000000n },
    previewDeposit: { assets: 101000000n, include: ["construction"] as const },
    previewMint: { shares: 100000000n },
    previewWithdraw: { assets: 9900000n },
    previewRedeem: { shares: 10000000n },
    context: true as const,
    ownership: { address: f.installed.receiver.address },
  };
}

export function queries(
  f: Flow,
  request: { txId: string; index: bigint },
  claim?: { txId: string; index: bigint },
) {
  return {
    ...economicRead(f),
    request: { ref: request },
    ...(claim ? { claim: { ref: claim } } : {}),
  };
}

function container(f: Flow) {
  const raw = JSON.parse(docker(["inspect", `${f.env.project}-indexer-1`]))[0];

  return {
    id: raw.Id as string,
    volume: (raw.Mounts as { Destination: string; Name?: string }[]).find(
      (mount) => mount.Destination === "/data",
    )?.Name,
  };
}

/** Compare every public field with a clean replay of the exact committed branch, using the service's explicit session identity. */
export function replay<Q extends ReadQueries>(
  f: Flow,
  requested: Q,
  actual: QueryResponse<Q>,
  label: string,
) {
  const snapshot = journalSnapshot(f.env);
  const reader = new VaultReader(
    f.env.config.network,
    f.env.config.reviewedBuilds,
    f.env.config.intersection,
  );

  for (const block of snapshot.blocks)
    reader.rollForward({
      ...block,
      point: { ...block.point, slot: BigInt(block.point.slot) },
      parent: { ...block.parent, slot: BigInt(block.parent.slot) },
    });

  expect(
    dispatchRead(
      reader,
      f.installed.deployment.policy,
      { apiVersion: QUERY_VERSION, queries: requested },
      actual.basis,
    ),
  ).toEqual(actual);
  write(f.env.directory, `${label}-journal`, snapshot);
}

/** Caller freezes disposable production first; clients receive only ordinary explicit query/basis arguments. */
export async function statelessRead<Q extends ReadQueries>(f: Flow, requested: Q, label: string) {
  const response = await synced(
    () => f.vault.read(requested),
    () => true,
    label,
  );
  const fresh = createIndexerClient({
    baseUrl: queryUrl,
    expectedNetwork: f.env.config.network,
  }).vault(f.installed.deployment.policy);

  expect(await fresh.read(requested, { expectedBasis: response.basis })).toEqual(response);
  replay(f, requested, response, label);
  write(f.env.directory, `${label}-sdk`, response);

  return response;
}

export async function persistentRestart<Q extends ReadQueries>(
  f: Flow,
  requested: Q,
  label: string,
  forced = false,
) {
  const before = await f.vault.read(requested);
  const beforeJournal = journalSnapshot(f.env);
  const old = container(f);

  if (forced) docker(["kill", "--signal", "KILL", `${f.env.project}-indexer-1`]);
  else f.env.compose("stop", "indexer");

  const exitCode = Number(
    docker(["inspect", "--format", "{{.State.ExitCode}}", `${f.env.project}-indexer-1`]),
  );

  expect(exitCode).toBe(forced ? 137 : 0);
  f.env.compose("stop", "ogmios");
  f.env.compose("rm", "-f", "indexer");
  f.env.compose("up", "-d", "--no-deps", "--no-build", "indexer");

  try {
    await eventually(
      async () =>
        (await fetch(`${queryUrl}/health/live`).catch(() => null))?.ok ? true : undefined,
      "recreated indexer live",
    );
    expect((await fetch(`${queryUrl}/health/ready`)).status).toBe(503);
    expect((await status()).lookupReady).toBe(false);
    await expect(f.vault.read(requested)).rejects.toMatchObject({ code: "READER_NOT_READY" });

    const unavailable = await fetch(`${queryUrl}/v1/vaults/${f.installed.deployment.policy}/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiVersion: QUERY_VERSION, queries: { snapshot: true } }),
    });

    expect(unavailable.status).toBe(503);

    const unavailableBody = await unavailable.json();

    expect(unavailableBody.data).toBeUndefined();
    write(f.env.directory, `${label}-unavailable`, unavailableBody);
  } finally {
    f.env.compose("up", "-d", "--no-deps", "ogmios");
  }

  const after = await synced(
    () => f.vault.read(requested),
    () => true,
    "persistent reader reconciliation",
  );

  expect(after.basis.instance).not.toBe(before.basis.instance);
  expect(after).toEqual({
    ...before,
    basis: {
      ...before.basis,
      instance: after.basis.instance,
      recoveryGeneration: after.basis.recoveryGeneration,
    },
  });
  expect(journalSnapshot(f.env)).toEqual(beforeJournal);

  const current = container(f);

  expect(current.id).not.toBe(old.id);
  expect(current.volume).toBe(old.volume);
  expect(current.volume).toBeTruthy();
  await expect(f.vault.read(requested, { expectedBasis: before.basis })).rejects.toMatchObject({
    code: "STALE_BASIS",
  });

  const fresh = createIndexerClient({
    baseUrl: queryUrl,
    expectedNetwork: f.env.config.network,
  }).vault(f.installed.deployment.policy);

  expect(await fresh.read(requested)).toEqual(after);
  await lookupReady(f.env, label);
  replay(f, requested, after, label);
  write(f.env.directory, label, {
    forced,
    exitCode,
    before,
    after,
    containers: { old, current },
    samePersistentJournal: true,
    readinessGated: true,
    staleBasisRejected: true,
  });

  return after;
}
