/** Replay genuine node-selected fork events offline; acceptance provenance lives beside the fixture. */
import {
  type NetworkBinding,
  type ReviewedBuild,
  readAcceptedTransaction,
  VaultReader,
} from "@ctvs/integration";
import { expect, it } from "vitest";
import fixture from "../fixtures/accepted/ctvs2-real-rollback.json" with { type: "json" };

type Point = { slot: string; blockHash: string };
type Event =
  | {
      direction: "forward";
      block: { point: Point; parent: Point; transactions: string[] };
      tip: Point;
    }
  | { direction: "backward"; from: Point; point: Point; tip: Point };

const point = (raw: Point) => ({ ...raw, slot: BigInt(raw.slot) });

const policy = fixture.expected.policy;
const request = { ...fixture.expected.request, index: BigInt(fixture.expected.request.index) };
const claim = { ...fixture.expected.claim, index: BigInt(fixture.expected.claim.index) };

const reader = () =>
  new VaultReader(
    fixture.network as NetworkBinding,
    fixture.reviewedBuilds as ReviewedBuild[],
    point(fixture.intersection),
  );

function apply(projection: VaultReader, event: Event) {
  if (event.direction === "backward") projection.rollBackward(point(event.point));
  else
    projection.rollForward({
      ...event.block,
      point: point(event.block.point),
      parent: point(event.block.parent),
    });
}

it("replays the actual delivery rollback into an unspent funded Claim with ownership reversed", () => {
  const projection = reader();
  let reversals = 0;

  for (const event of fixture.sessions.delivery as Event[]) {
    if (event.direction === "backward" && BigInt(event.from.slot) > BigInt(event.point.slot)) {
      const before = projection.context(policy).stateInput;
      const destination = projection.claim(policy, claim).data.claim.receiver.address;

      expect(projection.request(policy, request).data.status).toBe("delivered");
      expect(projection.ownership(policy, destination).data.freeShares).toBe(100000000n);
      apply(projection, event);
      expect(projection.context(policy).stateInput).toEqual(before);
      expect(projection.request(policy, request).data.status).toBe("claimable");
      expect(projection.request(policy, request).data.completion).toBeNull();
      expect(projection.claim(policy, claim).data.delivered).toBe(false);
      expect(projection.ownership(policy, destination).data.freeShares).toBe(0n);
      expect(projection.ownership(policy, destination).data.issuedUndeliveredShares).toBe(
        100000000n,
      );
      reversals++;
    } else apply(projection, event);
  }

  expect(reversals).toBe(1);
  expect(projection.request(policy, request).data.status).toBe("claimable");
});

it("replays actual settlement rollback, removes Claim lineage and applies only replacement cancellation", () => {
  const projection = reader();
  let reversals = 0;

  for (const event of fixture.sessions.settlement as Event[]) {
    if (event.direction === "backward" && BigInt(event.from.slot) > BigInt(event.point.slot)) {
      expect(projection.request(policy, request).data.status).toBe("claimable");
      apply(projection, event);
      expect(projection.request(policy, request).data.status).toBe("pending_escrow");
      expect(projection.request(policy, request).data.settlement).toBeNull();
      expect(() => projection.claim(policy, claim)).toThrow();
      expect(projection.recoverySource(policy, request).source.value.ada).toBe(108000000n);
      reversals++;
    } else apply(projection, event);
  }

  expect(reversals).toBe(1);

  const state = projection.snapshot(policy).data.state;

  expect(state.backingAssets).toBe(0n);
  expect(state.economicSupply).toBe(0n);
  expect(state.accruedFees).toBe(0n);
  expect(projection.request(policy, request).data.status).toBe("refunded");
  expect(projection.request(policy, request).data.completion?.txId).toBe(fixture.expected.cancel);
  expect(() => projection.recoverySource(policy, request)).toThrow("no unspent");

  const accepted = (fixture.sessions.settlement as Event[])
    .flatMap((event) => (event.direction === "forward" ? event.block.transactions : []))
    .map(readAcceptedTransaction)
    .find((tx) => tx.id === fixture.expected.cancel);

  expect(accepted?.outputs[0]?.value.ada).toBe(108000000n);
  expect(accepted?.inputs).not.toContainEqual(projection.context(policy).stateInput.ref);
});

it("matches the recorded node rollback wire messages to the accepted event targets", () => {
  for (const name of ["delivery", "settlement"] as const) {
    const reversed = (fixture.sessions[name] as Event[]).find(
      (event) =>
        event.direction === "backward" && BigInt(event.from.slot) > BigInt(event.point.slot),
    );

    if (reversed?.direction !== "backward") throw new Error("missing real rollback");

    const raw = fixture.wire[name];

    expect(raw.point).not.toBe("origin");

    if (typeof raw.point === "string") throw new Error("unexpected origin");

    expect({ slot: BigInt(raw.point.slot), blockHash: raw.point.id }).toEqual(
      point(reversed.point),
    );
    expect({ slot: BigInt(raw.tip.slot), blockHash: raw.tip.id }).toEqual(point(reversed.tip));
  }
});
