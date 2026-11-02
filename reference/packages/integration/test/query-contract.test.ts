/** SDK-01 fixes the request spelling before adding reader or HTTP dispatch. */
import { expect, it } from "vitest";
import { datum } from "../src/query/domain.js";
import { decodeReadRequest, encodeReadRequest, QUERY_VERSION } from "../src/query/index.js";

it("uses exact decimal quantities for a combined request and rejects unsafe or unknown inputs", () => {
  const input = {
    convertToAssets: { shares: 9007199254740993n },
    previewDeposit: { assets: 101000n, include: ["construction"] as ["construction"] },
    context: true as const,
  };
  const encoded = encodeReadRequest(input);

  expect(encoded).toBe(
    '{"apiVersion":"CTVS-QUERY-1","queries":{"convertToAssets":{"shares":"9007199254740993"},"previewDeposit":{"assets":"101000","include":["construction"]},"context":true}}',
  );
  expect(decodeReadRequest(JSON.parse(encoded)).queries).toEqual(input);

  for (const queries of [
    {},
    { nope: true },
    { toString: true },
    { previewDeposit: { shares: "1" } },
    { previewDeposit: { assets: Number("9007199254740993") } },
    { convertToShares: { assets: "01" } },
    { convertToShares: { assets: "-1" } },
    { convertToShares: { assets: "9".repeat(1000) } },
    { previewDeposit: { assets: "1", include: ["wallet"] } },
  ]) {
    expect(() => decodeReadRequest({ apiVersion: QUERY_VERSION, queries })).toThrow();
  }

  expect(() => encodeReadRequest({ convertToShares: { assets: 1 as unknown as bigint } })).toThrow(
    "bigint",
  );
});

it("preserves semantic datum maps, binary bytes, signed integers and large constructor alternatives", () => {
  const data = {
    constr: 9007199254740993n,
    fields: [{ map: [[-19n, new Uint8Array([0, 255])]] }, [0n]],
  } as const;
  const mutable = structuredClone(data) as unknown as Parameters<typeof datum.encode>[0];

  expect(datum.decode(datum.encode(mutable))).toEqual(mutable);

  for (const bad of [
    { constructor: { alternative: "0", fields: [] }, int: "1" },
    { constructor: {} },
    { map: [[{}]] },
    { int: "-0" },
  ])
    expect(() => datum.decode(bad)).toThrow();
});
