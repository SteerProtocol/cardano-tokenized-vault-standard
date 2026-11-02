/** Durable hosts must never publish invalid, reused or overtaken preparations, and selection must preserve genesis authentication. */
import { expect, it } from "vitest";
import { VaultReader } from "../src/index.js";
import { origin, readerFixture } from "./fixtures.js";

it("keeps a staged forward and rollback invisible until their one-use publication", () => {
  const f = readerFixture();
  const before = f.reader.chainPoint;
  const block = f.block([]);
  const update = f.reader.prepareForward(block);

  expect(f.reader.chainPoint).toEqual(before);
  expect(update.counts.blocks).toBe(2);
  block.point.slot = 999n;
  update.publish();
  expect(f.reader.chainPoint.slot).toBe(before.slot + 1n);
  expect(() => update.publish()).toThrow("already published");

  const rollback = f.reader.prepareBackward(origin);

  expect(f.reader.counts.vaults).toBe(1);
  rollback.publish();
  expect(f.reader.counts.vaults).toBe(0);
});

it("rejects an overtaken token without changing the newly published view", () => {
  const f = readerFixture();
  const first = f.reader.prepareForward(f.block([]));
  const other = f.block([]);

  f.reader.rollForward(other);
  expect(() => first.publish()).toThrow("stale");
  expect(f.reader.chainPoint).toEqual(other.point);
  expect(() =>
    f.reader.prepareForward({
      ...other,
      point: { slot: 3 as unknown as bigint, blockHash: "01".repeat(32) },
    }),
  ).toThrow("chain point");
});

it("authenticates only selected vault identities without inferring missing genesis", () => {
  const f = readerFixture();
  const selected = new VaultReader(f.network, [f.reviewed], origin, { vaultPolicies: [f.policy] });
  const excluded = new VaultReader(f.network, [f.reviewed], origin, {
    vaultPolicies: ["ff".repeat(28)],
  });

  expect(() => selected.snapshot(f.policy)).toThrow("genesis");
  selected.rollForward(f.genesis.block);
  excluded.rollForward(f.genesis.block);
  expect(selected.counts.vaults).toBe(1);
  expect(excluded.counts.vaults).toBe(0);
  expect(
    () => new VaultReader(f.network, [f.reviewed], origin, { vaultPolicies: ["bad"] }),
  ).toThrow("selected");
  expect(
    () => new VaultReader(f.network, [f.reviewed], origin, { vaultPolicies: [f.policy, f.policy] }),
  ).toThrow("duplicate");
});
