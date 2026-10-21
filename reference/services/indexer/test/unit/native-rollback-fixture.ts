/** Replay original wire-derived events; these fixtures retain local-node provenance, not independent consensus. */
import assert from "node:assert/strict";
import { type NetworkBinding, type ReviewedBuild, VaultReader } from "@ctvs/integration";
import { NAMES } from "@ctvs/protocol";
import { expect } from "vitest";

type Point = { slot: string; blockHash: string };
export type Event =
  | {
      direction: "forward";
      block: { point: Point; parent: Point; transactions: string[] };
      tip: Point;
    }
  | { direction: "backward"; from: Point; point: Point; tip: Point };

const point = (raw: Point) => ({ ...raw, slot: BigInt(raw.slot) });

export function projection(fixture: {
  network: unknown;
  reviewedBuilds: unknown;
  intersection: Point;
}) {
  return new VaultReader(
    fixture.network as NetworkBinding,
    fixture.reviewedBuilds as ReviewedBuild[],
    point(fixture.intersection),
  );
}

export const backward = (event: Event) =>
  event.direction === "backward" && BigInt(event.from.slot) > BigInt(event.point.slot);

export function apply(reader: VaultReader, event: Event) {
  if (event.direction === "backward") reader.rollBackward(point(event.point));
  else
    reader.rollForward({
      ...event.block,
      point: point(event.block.point),
      parent: point(event.block.parent),
    });
}

export function state(reader: VaultReader, policy: string, expected: Record<string, string>) {
  expect(reader.snapshot(policy).data.state).toEqual(
    Object.fromEntries(
      Object.entries(expected).map(([key, value]) => [
        key,
        ["vaultPolicy", "termsHash"].includes(key) ? value : BigInt(value),
      ]),
    ),
  );
}

export function custody(
  reader: VaultReader,
  policy: string,
  asset: { policy: string; name: string },
) {
  const actual = reader.snapshot(policy).data.state;
  const amount = actual.backingAssets + actual.accruedFees;

  expect(reader.context(policy).stateInput.value).toEqual({
    ada: 10000000n,
    [`${policy}.${NAMES.state}`]: 1n,
    ...(amount ? { [`${asset.policy}.${asset.name}`]: amount } : {}),
  });
}

export function wire(
  events: Event[],
  raw: { point: string | { slot: number; id: string }; tip: { slot: number; id: string } },
) {
  const reversals = events.filter(backward);

  expect(reversals).toHaveLength(1);

  const reversal = reversals[0];

  assert.ok(reversal?.direction === "backward" && typeof raw.point !== "string");
  expect({ slot: BigInt(raw.point.slot), blockHash: raw.point.id }).toEqual(point(reversal.point));
  expect({ slot: BigInt(raw.tip.slot), blockHash: raw.tip.id }).toEqual(point(reversal.tip));
}
