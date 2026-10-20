/** Fail closed on malformed or mixed response evidence without treating numeric-looking bytes as quantities. */
import { expect, it } from "vitest";
import { dispatchRead } from "../src/dispatch.js";
import { decodeQueryResponse, encodeQueryResponse, QUERY_VERSION } from "../src/query/index.js";
import { readerFixture } from "./fixtures.js";

const f = readerFixture("ctvs1");
const queries = {
  snapshot: true,
  context: true,
  previewDeposit: { assets: 101000n, include: ["construction"] },
} as const;
const response = dispatchRead(
  f.reader,
  f.policy,
  { apiVersion: QUERY_VERSION, queries },
  { instance: "test", recoveryGeneration: 1 },
);
const wire = JSON.parse(encodeQueryResponse(response));
const corruptions: ((v: typeof wire) => void)[] = [
  (v) => {
    v.apiVersion = "CTVS-QUERY-2";
  },
  (v) => {
    v.data.previewDeposit.result.value = 100000;
  },
  (v) => {
    v.data.previewDeposit.amount = "100001";
  },
  (v) => {
    v.data.previewDeposit.result.value = "01";
  },
  (v) => {
    v.data.previewDeposit.method = "previewMint";
  },
  (v) => {
    v.data.previewDeposit.inputUnit = "shares";
  },
  (v) => {
    v.data.previewDeposit.outputUnit = "assets";
  },
  (v) => {
    v.data.previewDeposit.units.shares = `${"00".repeat(28)}.5348415245`;
  },
  (v) => {
    v.data.previewDeposit.feeUnits.protocol = { policy: "00".repeat(28), name: "aa" };
  },
  (v) => {
    v.data.previewDeposit.quote.operation = "mint";
  },
  (v) => {
    v.data.previewDeposit.quote.amount = "1";
  },
  (v) => {
    delete v.data.previewDeposit.construction;
  },
  (v) => {
    v.basis.chainPoint.slot = "2";
  },
  (v) => {
    v.basis.stateRef.index = "10";
  },
  (v) => {
    v.vault.policy = "00".repeat(28);
  },
  (v) => {
    v.vault.share = `${f.policy}.00`;
  },
  (v) => {
    v.data.snapshot.state.termsHash = "00".repeat(32);
  },
  (v) => {
    v.data.context.deployment.buildId += "-other";
  },
  (v) => {
    v.data.context.deployment.claimScript = "00".repeat(28);
  },
  (v) => {
    v.data.context.deployment.configRef.index = "10";
  },
  (v) => {
    v.data.context.stateInput.ref.index = "10";
  },
  (v) => {
    v.data.context.stateInput.address.payment.type = "key";
  },
  (v) => {
    v.data.context.terms.networkDomain = "00".repeat(32);
  },
  (v) => {
    v.data.context.stateInput.value.invalid = "1";
  },
  (v) => {
    v.data.context.stateInput.value.ada = (1n << 64n).toString();
  },
  (v) => {
    v.data.previewDeposit.construction.terms.entryBps = "50";
  },
  (v) => {
    v.data.context.terms.underlying = { policy: "00".repeat(28), name: "aa" };
  },
  (v) => {
    v.data.extra = {};
  },
  (v) => {
    delete v.data.snapshot;
  },
];

it("rejects incompatible versions, quantities, State references and construction bindings", () => {
  for (const corrupt of corruptions) {
    const changed = structuredClone(wire);

    corrupt(changed);
    expect(
      () => decodeQueryResponse(changed, queries, f.policy, f.network),
      corrupt.toString(),
    ).toThrow("invalid query response");
  }

  expect(() =>
    decodeQueryResponse(wire, queries, f.policy, { ...f.network, genesisHash: "00".repeat(32) }),
  ).toThrow("network differs");

  const reordered = {
    ...wire,
    basis: {
      stateRef: wire.basis.stateRef,
      chainPoint: wire.basis.chainPoint,
      recoveryGeneration: 1,
      instance: "test",
    },
  };

  expect(decodeQueryResponse(reordered, queries, f.policy, f.network)).toEqual(response);

  const invalid = structuredClone(response);

  invalid.data.snapshot.state.backingAssets = -1n;
  expect(() => encodeQueryResponse(invalid)).toThrow("response contract");
});
