/** Tests authenticated discovery, reversible lifecycle projection and economic participation using synthetic histories. */
import { buildDirectPlan } from "@ctvs/ctvs1";
import { buildBatchPlan, buildDeliverPlan, buildRefundPlan, buildRequestPlan } from "@ctvs/ctvs2";
import { type FamilyStateContext, requestValue, type TransactionPlan } from "@ctvs/planning";
import {
  bytes,
  constr,
  enterprise,
  MAGIC,
  NAMES,
  type Request,
  recoveryData,
} from "@ctvs/protocol";
import { describe, expect, it } from "vitest";
import { key, required } from "../../planning/test/fixtures.js";
import { responseToJson, VaultReader } from "../src/index.js";
import { build, encodePlan, inputAt, origin, readerFixture } from "./fixtures.js";

function context(f: ReturnType<typeof readerFixture>): FamilyStateContext<"ctvs2"> {
  const c = f.reader.context(f.policy);

  if (c.deployment.family !== "ctvs2") throw new Error("wrong family");

  return { ...c, deployment: c.deployment };
}

function requestFor(
  f: ReturnType<typeof readerFixture>,
  overrides: Partial<Request["body"]> = {},
): Request {
  return {
    recovery: {
      vaultPolicy: f.policy,
      controller: key,
      refund: { address: f.owner, datum: null },
      deadlinePosixMs: 100_000n,
    },
    body: {
      termsHash: context(f).deployment.termsHash,
      kind: "deposit",
      offered: 101_000n,
      minimumOutput: 100_000n,
      receiver: { address: f.owner, datum: null },
      storageLovelace: 3_000_000n,
      executionBudget: 500_000n,
      settlerFee: 100_000n,
      ...overrides,
    },
  };
}

function pending(f: ReturnType<typeof readerFixture>, request = requestFor(f)) {
  const plan = buildRequestPlan({ ...context(f), request });
  const created = f.append(plan);
  const source = inputAt(plan, created.tx.id, 0);

  return { request, source, created };
}

function settled(f: ReturnType<typeof readerFixture>) {
  const funded = pending(f);
  const plan = buildBatchPlan({
    ...context(f),
    requests: [{ input: funded.source }],
    rewardKey: key,
    validity: { lowerPosixMs: 1n, upperPosixMs: 90_000n },
  });
  const accepted = f.append(plan);

  return { ...funded, plan, accepted, claim: inputAt(plan, accepted.tx.id, 1) };
}

describe("accepted-chain integration reader", () => {
  it.each(["ctvs1", "ctvs2"] as const)(
    "authenticates %s identity and coherent snapshots without trusting a supplied policy",
    (family) => {
      const f = readerFixture(family);
      const snapshot = f.reader.discover(`${f.policy.toUpperCase()}.${NAMES.share}`);

      expect(snapshot.chainPoint).toEqual(f.genesis.block.point);
      expect(snapshot.data.backingAssets).toEqual({ status: "known", value: 0n });
      expect(snapshot.verification.independentLedgerValidation).toBe(false);
      expect(snapshot.evidence.genesis).toBe(f.genesis.tx.id);
      expect(f.reader.responseStatus(snapshot)).toEqual({ status: "known", value: true });
      expect(JSON.parse(responseToJson(snapshot)).data.state.sequence).toBe("0");

      const withBytes = { ...snapshot, data: { bytes: bytes("aabb") } };

      expect(JSON.parse(responseToJson(withBytes)).data.bytes).toBe("aabb");
      expect(f.reader.responseStatus({ ...snapshot, chainPoint: origin }).status).toBe("stale");
      expect(f.reader.quote(f.policy, "deposit", 101_000n).data.result).toMatchObject({
        status: "known",
        value: { shares: 100_000n, fee: 1_000n },
      });
      expect(f.reader.quote(f.policy, "redeem", 1n).data.availability.status).toBe("unsupported");

      if (family === "ctvs2")
        expect(f.reader.quote(f.policy, "mint", 1n).data.availability.status).toBe("unsupported");

      snapshot.data.state.sequence = 999n;
      expect(f.reader.snapshot(f.policy).data.state.sequence).toBe(0n);
      expect(() => f.reader.discover(`${f.policy}.${NAMES.id}`)).toThrow("exact SHARE");
      expect(() => f.reader.snapshot("ff".repeat(28))).toThrow("authenticated genesis");
    },
  );
});

describe("accepted-chain integration reader", () => {
  it("tracks Claims only through funded settlement allocations, with reversible ownership and realization", () => {
    const f = readerFixture();
    const s = settled(f);
    const requestRef = s.source.ref;

    expect(f.reader.request(f.policy, requestRef).data.status).toBe("claimable");
    expect(
      f.reader.request(f.policy, requestRef).data.participation.issuedUndeliveredSharesParticipate,
    ).toBe(true);
    expect(f.reader.claim(f.policy, s.claim.ref).data.claim.economicQuantity).toBe(100_000n);

    const uppercaseOwner = {
      stake: f.owner.stake,
      payment: { ...f.owner.payment, hash: f.owner.payment.hash.toUpperCase() },
    };

    expect(f.reader.ownership(f.policy, uppercaseOwner).data.issuedUndeliveredShares).toBe(
      100_000n,
    );

    const delivery = buildDeliverPlan({ deployment: context(f).deployment, claims: [s.claim] });
    const delivered = f.append(delivery);

    expect(f.reader.request(f.policy, requestRef).data.status).toBe("delivered");
    expect(f.reader.ownership(f.policy, f.owner).data).toMatchObject({
      freeShares: 100_000n,
      issuedUndeliveredShares: 0n,
    });
    // Undo delivery first: Claim shares return to issued escrow, not to the pending deposit category.
    f.reader.rollBackward(s.accepted.block.point);
    expect(f.reader.claim(f.policy, s.claim.ref).data.delivered).toBe(false);
    expect(f.reader.ownership(f.policy, f.owner).data).toMatchObject({
      freeShares: 0n,
      issuedUndeliveredShares: 100_000n,
    });
    // Undo settlement next: remove Claim origin and restore the original recoverable Request.
    f.reader.rollBackward(s.created.block.point);
    expect(() => f.reader.claim(f.policy, s.claim.ref)).toThrow("authenticated settlement lineage");
    expect(f.reader.request(f.policy, requestRef).data.status).toBe("pending_escrow");
    expect(f.reader.ownership(f.policy, f.owner).data.pendingDepositAssets).toBe(101_000n);

    // A competing branch may refund the restored Request without retaining discarded settlement evidence.
    const cancel = buildRefundPlan({
      deployment: context(f).deployment,
      source: s.source,
      mode: "cancel",
      validity: { lowerPosixMs: 1n, upperPosixMs: 90_000n },
    });

    f.append(cancel);
    expect(f.reader.request(f.policy, requestRef).data.status).toBe("refunded");
    expect(f.reader.request(f.policy, requestRef).data.settlement).toBeNull();
    expect(() => f.reader.rollBackward(delivered.block.point)).toThrow("retained intersection");
    f.reader.rollBackward(origin);
    expect(() => f.reader.snapshot(f.policy)).toThrow("authenticated genesis");
  });
  it("separates controller authority, refund entitlement and issued Claim destination", () => {
    const f = readerFixture();
    const request = requestFor(f);
    const attacker = enterprise("ab".repeat(28), "key");

    request.recovery.refund.address = attacker;
    request.body.receiver.address = attacker;

    const p = pending(f, request);

    expect(f.reader.ownership(f.policy, f.owner).data).toMatchObject({
      pendingDepositAssets: 0n,
      controlledRequests: [p.source.ref],
    });
    expect(f.reader.ownership(f.policy, attacker).data).toMatchObject({
      pendingDepositAssets: 101_000n,
      controlledRequests: [],
    });
    expect(
      f.reader.request(f.policy, p.source.ref).data.participation.pendingDepositAssetsInBacking,
    ).toBe(false);
  });
});

describe("accepted-chain integration reader", () => {
  it("keeps unsupported economics recoverable without inventing participation", () => {
    const f = readerFixture(),
      request = requestFor(f);
    const plan = buildRequestPlan({ ...context(f), request });
    const output = plan.outputs[0];

    if (!output) throw new Error("missing output");

    output.datum = constr(1, [
      bytes(MAGIC),
      2n,
      recoveryData(request.recovery),
      constr(2n ** 53n, []),
    ]);

    const accepted = f.append(plan);
    const ref = { txId: accepted.tx.id, index: 0n };
    const status = f.reader.request(f.policy, ref).data;

    expect(status.requestValidation.status).toBe("unsupported");
    expect(status.recoveryAvailability.status).toBe("known");
    expect(f.reader.recoverySource(f.policy, ref).source.datumCbor).toBe(
      accepted.tx.outputs[0]?.datum,
    );
    expect(f.reader.candidate(f.policy, ref).data.classification).toBe("recognized_recovery");
    expect(() => f.reader.recoverySource(f.policy, { ...ref, index: 99n })).toThrow(
      "unspent recognized",
    );
    expect(f.reader.ownership(f.policy, f.owner).data.unsupportedRequests).toBe(1);
    expect(() => f.reader.request(f.policy, { ...ref, index: 99n })).toThrow("accepted origin");
  });
  it("ignores copied Config datums without ID and funded Claim lookalikes", () => {
    const f = readerFixture();
    const s = settled(f);
    const lookalike: TransactionPlan = {
      ...f.plan,
      operation: "create_request",
      inputs: [],
      mint: [],
      outputs: [
        {
          ...required(f.plan.outputs[0]),
          index: 0n,
          address: f.owner,
          value: { ada: 10_000_000n },
        },
        { ...required(s.plan.outputs[1]), index: 1n },
      ],
    };
    const fake = f.append(lookalike);

    expect(f.reader.snapshot(f.policy).data.state.sequence).toBe(1n);
    expect(() => f.reader.claim(f.policy, { txId: fake.tx.id, index: 1n })).toThrow(
      "authenticated settlement lineage",
    );
    expect(f.reader.ownership(f.policy, f.owner).data.issuedUndeliveredShares).toBe(100_000n);
  });
});

describe("accepted-chain integration reader", () => {
  it("requires contiguous blocks, rejects duplicate transactions atomically and handles empty rollback", () => {
    const f = readerFixture(),
      before = f.reader.chainPoint;

    expect(() => f.reader.rollForward({ ...f.block([]), parent: origin })).toThrow("noncontiguous");
    expect(() => f.reader.rollForward(f.block([f.genesis.cbor]))).toThrow("duplicate");
    expect(f.reader.chainPoint).toEqual(before);
    f.reader.rollForward(f.block([]));
    f.reader.rollBackward(before);
    expect(f.reader.chainPoint).toEqual(before);
    expect(() => new VaultReader({ ...f.network, networkMagic: -1 }, [build], origin)).toThrow(
      "network binding",
    );
    expect(() => new VaultReader(f.network, [], origin)).toThrow("reviewed build");
    expect(() => new VaultReader(f.network, [build], { ...origin, blockHash: "bad" })).toThrow(
      "chain point",
    );

    const foreign = new VaultReader(
      { ...f.network, domain: "ff".repeat(32) },
      [f.reviewed],
      origin,
    );

    foreign.rollForward(f.genesis.block);
    expect(() => foreign.snapshot(f.policy)).toThrow("authenticated genesis");
  });
  it("does not recognize a phase-two-invalid genesis or create its ordinary outputs", () => {
    const f = readerFixture();
    const reader = new VaultReader(f.network, [f.reviewed], origin);

    reader.rollForward({ ...f.genesis.block, transactions: [encodePlan(f.plan, false)] });
    expect(() => reader.snapshot(f.policy)).toThrow("authenticated genesis");
  });
  it("preserves direct successor accounting and economic quote limits", () => {
    const f = readerFixture("ctvs1");
    const c = f.reader.context(f.policy);

    if (c.deployment.family !== "ctvs1") throw new Error("wrong family");

    const plan = buildDirectPlan({
      ...c,
      deployment: c.deployment,
      operation: "deposit",
      amount: 101_000n,
      bound: 100_000n,
      receiver: { address: f.owner, datum: null },
      receiverTopup: 2_000_000n,
    });

    f.append(plan);
    expect(f.reader.snapshot(f.policy).data.state).toMatchObject({
      sequence: 1n,
      backingAssets: 100_000n,
      economicSupply: 100_000n,
      accruedFees: 1_000n,
    });
    expect(f.reader.quote(f.policy, "withdraw", 1n).data.availability.status).toBe("known");
  });
  it("identifies escrowed redemption shares separately from unissued deposits", () => {
    const f = readerFixture();
    const request = requestFor(f, { kind: "redeem", offered: 123n, minimumOutput: 1n });
    const p = pending(f, request);

    expect(p.source.value).toEqual(requestValue(request, context(f).terms));
    expect(f.reader.ownership(f.policy, f.owner).data.lockedRedemptionShares).toBe(123n);
    expect(
      f.reader.request(f.policy, p.source.ref).data.participation.redemptionEscrowSharesParticipate,
    ).toBe(true);
  });
});
