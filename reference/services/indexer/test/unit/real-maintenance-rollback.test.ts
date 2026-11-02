/** Original node fork events restore maintenance accounting, custody, availability and async lineage. */
import type { VaultReader } from "@ctvs/integration";
import { dispatchRead } from "@ctvs/integration";
import { ECONOMIC_METHODS, QUERY_VERSION } from "@ctvs/integration/query";
import { type Address, NAMES } from "@ctvs/protocol";
import { expect, it } from "vitest";
import ada1 from "../fixtures/accepted/ctvs1-ada-maintenance-real-rollback.json" with {
  type: "json",
};
import native1 from "../fixtures/accepted/ctvs1-native-maintenance-real-rollback.json" with {
  type: "json",
};
import ada2 from "../fixtures/accepted/ctvs2-ada-maintenance-real-rollback.json" with {
  type: "json",
};
import native2 from "../fixtures/accepted/ctvs2-native-maintenance-real-rollback.json" with {
  type: "json",
};
import { apply, backward, type Event, projection, state, wire } from "./native-rollback-fixture.js";

const fixtures = [ada1, native1, ada2, native2];

type Fixture = (typeof fixtures)[number];

const ref = (raw: { txId: string; index: string }) => ({ ...raw, index: BigInt(raw.index) });

function read(reader: VaultReader, fixture: Fixture) {
  const { request, claim } = fixture.expected;

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
        previewDeposit: { assets: 101000000n },
        previewMint: { shares: 100000000n },
        previewWithdraw: { assets: 9900000n },
        previewRedeem: { shares: 10000000n },
        ...(request ? { request: { ref: ref(request) } } : {}),
        ...(claim ? { claim: { ref: ref(claim) } } : {}),
      },
    },
    { instance: "recorded-maintenance-rollback", recoveryGeneration: 0 },
  );
}

function verifyViews(fixture: Fixture, response: ReturnType<typeof read>) {
  const expected = {
    convertToAssets: 10000000n,
    convertToShares: 10000000n,
    previewDeposit: 100000000n,
    previewMint: 101000000n,
    previewWithdraw: 9999000n,
    previewRedeem: 9900990n,
  };
  const flags = response.data.snapshot.state.pauseFlags;

  for (const method of ECONOMIC_METHODS) {
    const view = response.data[method];

    expect(view.result).toEqual({ status: "known", value: expected[method] });
    expect(view.units.assets).toEqual(fixture.expected.underlying);
    expect(view.feeUnits.protocol).toEqual(fixture.expected.underlying);
    expect(view.feeUnits.storage).toBe("lovelace");

    if (method === "convertToAssets" || method === "convertToShares")
      expect(view.availability).toEqual({ status: "not_applicable", code: "VALUATION_ONLY" });
    else if (
      fixture.expected.family === "ctvs2" &&
      (method === "previewMint" || method === "previewWithdraw")
    )
      expect(view.availability).toEqual({
        status: "unsupported",
        code: "ASYNC_EXECUTION_UNSUPPORTED",
      });
    else {
      const entry = method === "previewDeposit" || method === "previewMint";
      const paused = entry ? flags === 1n || flags === 3n : flags === 2n || flags === 3n;

      expect(view.availability).toEqual(
        paused
          ? { status: "unavailable", code: "PAUSED" }
          : { status: "available", code: "AVAILABLE" },
      );
    }
  }
}

function custody(fixture: Fixture, response: ReturnType<typeof read>) {
  const s = response.data.snapshot.state;
  const underlying = fixture.expected.underlying;
  const amount = 100000000n + s.accruedFees;

  expect(s.backingAssets).toBe(100000000n);
  expect(s.economicSupply).toBe(100000000n);
  expect(response.data.context.stateInput.value).toEqual({
    [`${fixture.expected.policy}.${NAMES.state}`]: 1n,
    ...(typeof underlying === "string"
      ? { ada: s.storageLovelace + amount }
      : { ada: s.storageLovelace, [`${underlying.policy}.${underlying.name}`]: amount }),
  });
  expect(response.data.ownership.freeShares).toBe(100000000n);
  expect(response.data.context.deployment.configRef).toEqual(ref(fixture.expected.configRef));
}

it.each(
  fixtures.flatMap((fixture) =>
    fixture.expected.branches.map((branch) => ({
      fixture,
      branch,
      label: `${fixture.expected.family} ${fixture.expected.underlying === "ada" ? "ada" : "native"} ${branch.step.stage}`,
    })),
  ),
)("reverses $label at its actual Ogmios ancestor", ({ fixture, branch }) => {
  const reader = projection(fixture);
  const stage = branch.step.stage as keyof typeof fixture.wire;
  let reversals = 0;

  for (const event of fixture.sessions[stage] as Event[]) {
    if (backward(event)) {
      state(reader, fixture.expected.policy, branch.afterState);
      expect(reader.context(fixture.expected.policy).stateInput.ref.txId).toBe(branch.txId);

      const before = read(reader, fixture);

      apply(reader, event);
      state(reader, fixture.expected.policy, branch.beforeState);

      const after = read(reader, fixture);

      expect(after.data.context.stateInput.ref).toEqual(ref(branch.beforeInput.ref));
      expect(after.data.ownership).toEqual(before.data.ownership);
      expect(after.data.snapshot.terms).toEqual(before.data.snapshot.terms);
      expect(after.data.request).toEqual(before.data.request);
      expect(after.data.claim).toEqual(before.data.claim);
      custody(fixture, after);
      verifyViews(fixture, after);

      for (const method of ECONOMIC_METHODS)
        expect(after.data[method].quote).toEqual(before.data[method].quote);

      reversals++;
    } else apply(reader, event);
  }

  expect(reversals).toBe(1);
  state(reader, fixture.expected.policy, branch.beforeState);
});

it.each(fixtures)(
  "matches all six $expected.family maintenance backward targets to original wire messages",
  (fixture) => {
    for (const stage of Object.keys(fixture.wire) as (keyof typeof fixture.wire)[])
      wire(fixture.sessions[stage] as Event[], fixture.wire[stage]);
  },
);

it.each(fixtures)(
  "replays only replacement $expected.family maintenance after all original actions are orphaned",
  (fixture) => {
    const reader = projection(fixture);

    for (const event of fixture.sessions.replacement as Event[]) apply(reader, event);

    state(reader, fixture.expected.policy, fixture.expected.finalState);

    const response = read(reader, fixture);

    expect(response.basis.stateRef.txId).toBe(fixture.expected.replacement.at(-1)?.txId);
    expect(response.data.snapshot.state).toMatchObject({
      sequence: 6n,
      accruedFees: 0n,
      storageLovelace: 11000000n,
      pauseFlags: 0n,
    });

    for (const row of fixture.expected.replacement)
      expect(fixture.expected.branches.map((branch) => branch.txId)).not.toContain(row.txId);

    custody(fixture, response);
    verifyViews(fixture, response);
  },
);
