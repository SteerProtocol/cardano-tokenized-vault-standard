/** Fixed fee vectors test named reader behavior; these fabricated headers do not establish node acceptance. */
import { expect, it } from "vitest";
import { fixture } from "../../planning/test/fixtures.js";
import { economicView } from "../src/economics.js";
import { dispatchRead, toPlannerContext } from "../src/index.js";
import {
  decodeQueryResponse,
  decodeReadRequest,
  ECONOMIC_METHODS,
  encodeQueryResponse,
  QueryError,
} from "../src/query/index.js";
import ctvs1Response from "./fixtures/query-v1.ctvs1.response.json" with { type: "json" };
import ctvs2Response from "./fixtures/query-v1.ctvs2.response.json" with { type: "json" };
import golden from "./fixtures/query-v1.json" with { type: "json" };
import { readerFixture } from "./fixtures.js";

it.each(["ctvs1", "ctvs2"] as const)(
  "serves all six %s views with common evidence and exact fee vectors",
  (family) => {
    const f = readerFixture(family);
    const request = decodeReadRequest({ apiVersion: golden.apiVersion, queries: golden.queries });
    const response = dispatchRead(f.reader, f.policy, request, {
      instance: "fixture",
      recoveryGeneration: 1,
    });
    const wire = JSON.parse(encodeQueryResponse(response));

    expect(wire).toEqual(family === "ctvs1" ? ctvs1Response : ctvs2Response);

    const decoded = decodeQueryResponse(wire, request.queries, f.policy, f.network);

    for (const method of ECONOMIC_METHODS) {
      expect(decoded.data[method].result).toEqual({
        status: "known",
        value: BigInt(golden.expectedResults[method]),
      });
      expect(decoded.data[method].method).toBe(method);
      expect(decoded.data[method].protocolFeeDestination).toEqual(
        f.reader.context(f.policy).terms.feeDestination,
      );
      expect(decoded.data[method].constructionMaximum.status).toBe("unknown");

      if (method.startsWith("preview")) {
        expect(decoded.data[method].fees.protocol).toEqual({ status: "known", value: 1000n });
        expect(decoded.data[method].pricing).toBe(golden.families[family].previewPricing);
      }
    }

    expect(decoded.data.previewMint.capabilities.construction).toBe(
      golden.families[family].mintConstruction,
    );
    expect(decoded.evidence.state).toEqual(f.reader.context(f.policy).stateInput.ref);
    expect(() =>
      decodeQueryResponse(wire, request.queries, f.policy, { ...f.network, networkMagic: 43 }),
    ).toThrow(QueryError);

    const bad = structuredClone(wire);

    bad.data.previewDeposit.method = "previewMint";
    expect(() => decodeQueryResponse(bad, request.queries, f.policy, f.network)).toThrow(
      "invalid query response",
    );
  },
);

it("includes original State bytes only when requested and preserves the legacy quote interface", () => {
  const f = readerFixture("ctvs1");
  const ordinary = f.reader.previewDeposit(f.policy, { assets: 101000n });

  expect(ordinary.data.construction).toBeUndefined();

  const included = f.reader.previewDeposit(f.policy, {
    assets: 101000n,
    include: ["construction"],
  });

  if (!included.data.construction) throw new Error("missing construction");

  expect(toPlannerContext(included.data.construction)).toEqual(f.reader.context(f.policy));

  const legacy = f.reader.quote(f.policy, "deposit", 101000n).data.result;

  expect(included.data.quote).toEqual(legacy.status === "known" ? legacy.value : null);

  const async = readerFixture();

  expect(() =>
    async.reader.previewMint(async.policy, { shares: 1n, include: ["construction"] }),
  ).toThrow("supported construction");
});

it("keeps pause, mode, zero and liquidity decisions separate from valid arithmetic", () => {
  const f = fixture("ctvs1");

  const view = (state = f.state, terms = f.terms, amount = 101000n) =>
    economicView("previewDeposit", amount, state, terms, false);

  expect(view({ ...f.state, pauseFlags: 1n }).availability.code).toBe("PAUSED");
  expect(view(f.state, { ...f.terms, executionModes: 2n }).availability.code).toBe("MODE_DISABLED");
  expect(view(f.state, f.terms, 0n).availability.code).toBe("ZERO_INPUT");
  expect(view(f.state, f.terms, 1n).availability.code).toBe("ZERO_OUTPUT");
  expect(view(f.state, { ...f.terms, maxBacking: f.state.backingAssets }).availability.code).toBe(
    "ECONOMIC_LIMIT",
  );
  expect(economicView("convertToAssets", 0n, f.state, f.terms, false).result).toEqual({
    status: "known",
    value: 0n,
  });
  expect(() => view(f.state, f.terms, 1n << 63n)).toThrow();
  expect(economicView("previewMint", 10n, f.state, f.terms, true).availability.status).toBe(
    "unsupported",
  );
});

it.each(["ctvs1", "ctvs2"] as const)(
  "uses non-exact virtualized rounding and zero fees for %s",
  (family) => {
    // Price is (backing + 1)/(supply + virtual shares) = 3/2.
    const f = family === "ctvs1" ? fixture("ctvs1") : fixture("ctvs2");
    const state = { ...f.state, backingAssets: 2n, economicSupply: 1n };
    const terms = { ...f.terms, entryBps: 0n, exitBps: 0n };
    const expected = {
      convertToAssets: 1n,
      convertToShares: 0n,
      previewDeposit: 0n,
      previewMint: 2n,
      previewWithdraw: 1n,
      previewRedeem: 1n,
    };

    for (const method of ECONOMIC_METHODS) {
      const view = economicView(method, 1n, state, terms, family === "ctvs2");

      expect(view.result).toEqual({ status: "known", value: expected[method] });

      if (method.startsWith("preview"))
        expect(view.fees.protocol).toEqual({ status: "known", value: 0n });
    }
  },
);
