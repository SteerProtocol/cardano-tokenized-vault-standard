/** Exercise the daemon's reconciler during Kupo outages and real node branch replacement. */
import type { ReadQueries } from "@ctvs/integration/query";
import { expect } from "vitest";
import type { Runner } from "../../../src/runner.js";
import { type environment, eventually, queryUrl, write } from "./environment.js";
import type { Flow } from "./flow.js";
import { adopt, type ForkNode, forge, freeze, primary, tip } from "./fork.js";

type Status = Omit<ReturnType<Runner["status"]>, "readerHead" | "durableHead" | "kupo"> & {
  readerHead: { slot: string; blockHash: string };
  durableHead: { slot: string; blockHash: string };
  kupo: {
    verification: string;
    reason: string;
    basis: {
      instance: string;
      recoveryGeneration: number;
      point: { slot: string; blockHash: string };
    } | null;
  };
};

export async function status(): Promise<Status> {
  return (await fetch(`${queryUrl}/status`)).json();
}

export async function lookupReady(env: ReturnType<typeof environment>, label: string) {
  const current = await eventually(async () => {
    const value = await status();

    return value.lookupReady ? value : undefined;
  }, "automatic Kupo reconciliation");

  expect(current.readerReady).toBe(true);
  expect(current.kupo.verification).toBe("verified");
  expect(current.kupo.basis).toEqual({
    instance: current.instance,
    recoveryGeneration: current.recoveryGeneration,
    point: current.readerHead,
  });
  expect(current.durableHead).toEqual(current.readerHead);
  write(env.directory, `${label}-lookup-ready`, current);

  return current;
}

export async function kupoRestart(f: Flow, requested: ReadQueries) {
  const initial = await lookupReady(f.env, "before-kupo-restart");
  const before = await f.vault.read(requested);

  f.env.compose("stop", "kupo");

  try {
    const unavailable = await eventually(async () => {
      const value = await status();

      return !value.lookupReady ? value : undefined;
    }, "lookup unavailable while Kupo is stopped");

    expect(unavailable.readerReady).toBe(true);
    expect(await f.vault.read(requested)).toEqual(before);
    forge(primary(f.env));
    await eventually(
      async () => (tip(primary(f.env)).hash !== initial.readerHead.blockHash ? true : undefined),
      "node advanced without Kupo",
    );

    const selected = await freeze(primary(f.env));
    const lagging = await eventually(async () => {
      const value = await status();

      return value.readerReady && value.readerHead.blockHash === selected.hash ? value : undefined;
    }, "reader caught up independently of Kupo");

    expect(lagging.lookupReady).toBe(false);

    const during = await f.vault.read(requested);

    expect(during.data.snapshot?.state).toEqual(before.data.snapshot?.state);
    write(f.env.directory, "kupo-restart-unavailable", {
      initial,
      unavailable,
      lagging,
      before,
      during,
    });
  } finally {
    f.env.compose("up", "-d", "--no-deps", "kupo");
  }

  const recovered = await lookupReady(f.env, "after-kupo-restart");

  expect(recovered.instance).toBe(initial.instance);
  expect(recovered.readerHead.blockHash).not.toBe(initial.readerHead.blockHash);
}

/** The reader must select the new fork and serve its data while Kupo still holds the old database. */
export async function reconcileFork(
  f: Flow,
  node: ForkNode,
  label: string,
  requested: ReadQueries,
) {
  const before = await lookupReady(f.env, `${label}-before`);

  f.env.compose("stop", "kupo");

  let selected: ReturnType<typeof tip>;

  try {
    selected = await adopt(f.env, node, label);

    const held = await eventually(async () => {
      const value = await status();

      return value.readerReady && value.readerHead.blockHash === selected.hash ? value : undefined;
    }, "reader selected fork while Kupo stopped");
    const response = await f.vault.read(requested);

    expect(held.lookupReady).toBe(false);
    expect(held.instance).toBe(before.instance);
    expect(held.recoveryGeneration).toBeGreaterThan(before.recoveryGeneration);
    expect(response.basis.chainPoint.blockHash).toBe(selected.hash);
    write(f.env.directory, `${label}-kupo-held`, { before, selected, held, response });
  } finally {
    f.env.compose("up", "-d", "--no-deps", "kupo");
  }

  const reconciled = await lookupReady(f.env, label);
  const checkpoints = await (await fetch(`${f.env.config.sources.kupo}/checkpoints`)).json();

  expect(checkpoints[0]).toEqual({ slot_no: selected.slot, header_hash: selected.hash });
  write(f.env.directory, `${label}-kupo-checkpoints`, {
    selected,
    checkpoints,
    reconciled,
    automaticLookupReconciliation: true,
  });

  return selected;
}
