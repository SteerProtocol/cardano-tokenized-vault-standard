/** Replay actual mixed-batch backward events, preserving both gross obligations and replacement lineage. */
import assert from "node:assert/strict";
import { dispatchRead, readAcceptedTransaction, type VaultReader } from "@ctvs/integration";
import { ECONOMIC_METHODS, QUERY_VERSION } from "@ctvs/integration/query";
import { type Address, NAMES } from "@ctvs/protocol";
import { expect, it } from "vitest";
import ada from "../fixtures/accepted/ctvs2-ada-mixed-real-rollback.json" with { type: "json" };
import native from "../fixtures/accepted/ctvs2-native-mixed-real-rollback.json" with {
  type: "json",
};
import { apply, backward, type Event, projection, state, wire } from "./native-rollback-fixture.js";

const fixtures = [ada, native];

type Fixture = (typeof fixtures)[number];
type Branch = Fixture["expected"]["branches"][number];

const ref = (raw: { txId: string; index: string | bigint }) => ({
  ...raw,
  index: BigInt(raw.index),
});

function read(
  reader: VaultReader,
  fixture: Fixture,
  branch: Branch,
  index: number,
  claim: boolean,
) {
  const requestRef = branch.requests[index];
  const claimRef = branch.claims[index];

  assert.ok(requestRef && claimRef);

  return dispatchRead(
    reader,
    fixture.expected.policy,
    {
      apiVersion: QUERY_VERSION,
      queries: {
        snapshot: true,
        context: true,
        ownership: { address: fixture.expected.owner as Address },
        convertToAssets: { shares: 10000000n },
        convertToShares: { assets: 10000000n },
        previewDeposit: { assets: BigInt(branch.step.deposit), include: ["construction"] },
        previewMint: { shares: 100000000n },
        previewWithdraw: { assets: 9900000n },
        previewRedeem: { shares: BigInt(branch.step.redeem), include: ["construction"] },
        request: { ref: ref(requestRef) },
        ...(claim ? { claim: { ref: ref(claimRef) } } : {}),
      },
    },
    { instance: "recorded-mixed-rollback", recoveryGeneration: 0 },
  );
}

function views(reader: VaultReader, fixture: Fixture, branch: Branch) {
  const response = read(reader, fixture, branch, 0, false);
  const expected = {
    convertToAssets: 10000000n,
    convertToShares: 10000000n,
    previewDeposit: BigInt(branch.step.issued),
    previewMint: 101000000n,
    previewWithdraw: 9999000n,
    previewRedeem: BigInt(branch.step.redeemed),
  };
  const asset = fixture.expected.underlying;
  const s = response.data.snapshot.state;
  const amount = s.backingAssets + s.accruedFees;

  for (const method of ECONOMIC_METHODS) {
    expect(response.data[method].result).toEqual({ status: "known", value: expected[method] });
    expect(response.data[method].units.assets).toEqual(asset);
    expect(response.data[method].feeUnits.protocol).toEqual(asset);
  }

  expect(response.data.context.stateInput.value).toEqual({
    [`${fixture.expected.policy}.${NAMES.state}`]: 1n,
    ...(typeof asset === "string"
      ? { ada: amount + 10000000n }
      : {
          ada: 10000000n,
          [`${asset.policy}.${asset.name}`]: amount,
        }),
  });
  expect(response.data.previewDeposit.construction).toEqual(response.data.context);
  expect(response.data.previewRedeem.construction).toEqual(response.data.context);
  expect(response.data.context.deployment.configRef).toEqual(ref(fixture.expected.configRef));
}

function restored(reader: VaultReader, fixture: Fixture, branch: Branch, phase: string) {
  const delivery = phase === "delivery";
  const expectedState = delivery ? branch.fixedState : branch.beforeState;

  state(reader, fixture.expected.policy, expectedState);

  for (const index of [0, 1]) {
    const response = read(reader, fixture, branch, index, delivery);

    expect(response.basis.stateRef).toEqual(
      ref(delivery ? branch.fixedInput.ref : branch.beforeInput.ref),
    );
    expect(response.data.ownership).toMatchObject(
      Object.fromEntries(
        Object.entries(delivery ? branch.fixedOwnership : branch.beforeOwnership).map(
          ([key, value]) => [key, BigInt(value)],
        ),
      ),
    );
    expect(response.data.request.status).toBe(delivery ? "claimable" : "pending_escrow");
    expect(response.data.request.completion).toBeNull();

    if (delivery) {
      expect(response.data.claim.unspent).toBe(true);
      expect(response.data.claim.claim.requestRef).toEqual(ref(response.data.request.ref));
      expect(response.data.claim.claim.stateRef).toEqual(ref(branch.beforeInput.ref));
      expect(response.data.claim.claim.economicQuantity).toBe(
        BigInt(index === 0 ? branch.step.issued : branch.step.redeemed),
      );

      const value = branch.claimValues[index];

      assert.ok(value);
      expect(response.data.claim.source.value).toEqual(
        Object.fromEntries(Object.entries(value).map(([key, amount]) => [key, BigInt(amount)])),
      );
    } else {
      expect(response.data.request.settlement).toBeNull();

      const claim = branch.claims[index];

      assert.ok(claim);
      expect(() => reader.claimView(fixture.expected.policy, ref(claim))).toThrow();
    }
  }

  views(reader, fixture, branch);
}

const cases = fixtures.flatMap((fixture) =>
  fixture.expected.branches.flatMap((branch) =>
    ["delivery", "settlement"].map((phase) => ({
      fixture,
      branch,
      phase,
      label: `${fixture.expected.underlying === "ada" ? "ada" : "native"} ${branch.step.stage} ${phase}`,
    })),
  ),
);

it.each(cases)(
  "restores both gross obligations on actual $label rollback",
  ({ fixture, branch, phase }) => {
    const reader = projection(fixture);
    const label = `${branch.step.stage}-${phase}` as keyof typeof fixture.sessions;
    let reversed = 0;

    for (const event of fixture.sessions[label] as Event[]) {
      if (backward(event)) {
        const before = read(reader, fixture, branch, 0, true);

        expect(before.data.request.status).toBe(phase === "delivery" ? "delivered" : "claimable");
        expect(event.direction === "backward" ? event.point : null).toEqual(
          phase === "delivery" ? branch.deliveryCommon : branch.settlementCommon,
        );
        apply(reader, event);
        restored(reader, fixture, branch, phase);
        reversed++;
      } else apply(reader, event);
    }

    expect(reversed).toBe(1);
    restored(reader, fixture, branch, phase);
  },
);

it.each(fixtures)(
  "matches all six $expected.underlying backward targets to original wire responses",
  (fixture) => {
    for (const [label, raw] of Object.entries(fixture.wire))
      wire(fixture.sessions[label as keyof typeof fixture.sessions] as Event[], raw);
  },
);

it.each(fixtures)(
  "retains only replacement $expected.underlying mixed-batch lineage",
  (fixture) => {
    const reader = projection(fixture);

    for (const event of fixture.sessions.replacement as Event[]) apply(reader, event);

    const first = fixture.expected.branches[0];
    const replacement = fixture.expected.replacement;

    assert.ok(first);
    state(reader, fixture.expected.policy, fixture.expected.finalState);
    expect(reader.context(fixture.expected.policy).stateInput.ref).toEqual(
      ref(fixture.expected.finalStateRef),
    );
    expect(
      reader.ownership(fixture.expected.policy, fixture.expected.owner as Address).data.freeShares,
    ).toBe(105555560n);

    for (const [index, request] of first.requests.entries()) {
      const actual = reader.request(fixture.expected.policy, ref(request)).data;
      const claim = replacement.claims[index];

      assert.ok(claim);
      expect(actual.status).toBe("delivered");
      expect(actual.settlement?.claimRef).toEqual(ref(claim));
      expect(actual.completion?.txId).toBe(replacement.deliver);
    }

    for (const branch of fixture.expected.branches) {
      for (const claim of branch.claims)
        expect(() => reader.claimView(fixture.expected.policy, ref(claim))).toThrow();

      if (branch !== first)
        for (const request of branch.requests)
          expect(() => reader.request(fixture.expected.policy, ref(request))).toThrow();
    }

    const accepted = (fixture.sessions.replacement as Event[])
      .flatMap((event) => (event.direction === "forward" ? event.block.transactions : []))
      .map(readAcceptedTransaction)
      .find((tx) => tx.id === replacement.settle);

    assert.ok(accepted);
    expect(accepted.inputs).toContainEqual(ref(first.beforeInput.ref));

    for (const request of first.requests) expect(accepted.inputs).toContainEqual(ref(request));

    expect(replacement.settle).not.toBe(first.settle);
    views(reader, fixture, first);
  },
);
