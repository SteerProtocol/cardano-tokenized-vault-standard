/** Common Price wire tests do not certify any provider's economic calculations. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  bytes,
  constr,
  decodeData,
  encodeData,
  hex,
  type Price,
  type PriceAssertion,
  priceFromData,
  priceQueryKey,
  priceToData,
  Q_MAX,
} from "../src/index.js";

function fixture(): Price {
  return {
    version: 1n,
    marketId: { policy: "dd".repeat(28), name: "4d41524b4554" },
    shareAsset: { policy: "ee".repeat(28), name: "52454345495054" },
    underlyingAsset: { policy: "ff".repeat(28), name: "5553444358" },
    assertions: [
      { kind: "ConvertToAssets", shares: 50_000_000_000n, assets: 550_000_000n },
      { kind: "ConvertToShares", assets: 550_000_000n, shares: 50_000_000_000n },
      { kind: "PreviewDeposit", assetsIn: 550_000_000n, sharesOut: 50_000_000_000n },
      { kind: "PreviewMint", sharesOut: 50_000_000_000n, assetsIn: 550_000_000n },
      { kind: "PreviewWithdraw", assetsOut: 550_000_000n, sharesIn: 50_000_000_000n },
      { kind: "PreviewRedeem", sharesIn: 50_000_000_000n, assetsOut: 550_000_000n },
    ],
    evidence: constr(0, [constr(0, [bytes("11".repeat(32)), 2n])]),
  };
}

describe("optional Price encoding", () => {
  it("round-trips all tags and keeps exact-output inputs first", () => {
    const price = fixture(),
      data = priceToData(price);

    expect(data.fields[4]).toEqual([
      constr(0, [50_000_000_000n, 550_000_000n]),
      constr(1, [550_000_000n, 50_000_000_000n]),
      constr(2, [550_000_000n, 50_000_000_000n]),
      constr(3, [50_000_000_000n, 550_000_000n]),
      constr(4, [550_000_000n, 50_000_000_000n]),
      constr(5, [50_000_000_000n, 550_000_000n]),
    ]);
    expect(priceFromData(decodeData(encodeData(data)))).toEqual(price);
  });

  it("accepts equivalent Data spelling without promising byte preservation", () => {
    const encoded = hex(encodeData(priceToData(fixture())));
    // Extended constructor encoding for outer alternative zero is equivalent to tag 121.
    const alternate = `d866821800${encoded.slice(4)}`;

    expect(priceFromData(decodeData(bytes(alternate)))).toEqual(fixture());
    expect(alternate).not.toEqual(encoded);
  });

  it("matches the committed all-method vector checked by Aiken", () => {
    const vector = JSON.parse(
      readFileSync(new URL("./fixtures/price-v1.json", import.meta.url), "utf8"),
    ) as { cbor: string };

    expect(hex(encodeData(priceToData(fixture())))).toEqual(vector.cbor);
    expect(priceFromData(decodeData(bytes(vector.cbor)))).toEqual(fixture());
  });

  it("allows zero views and quantities above the JavaScript safe-integer range", () => {
    const price = fixture();

    price.assertions = [
      { kind: "ConvertToAssets", shares: 0n, assets: 0n },
      { kind: "ConvertToAssets", shares: Q_MAX, assets: Q_MAX },
    ];
    expect(priceFromData(decodeData(encodeData(priceToData(price))))).toEqual(price);
  });

  it("uses operation plus fixed input as query identity", () => {
    expect(priceQueryKey({ kind: "PreviewMint", sharesOut: 10n, assetsIn: 12n })).toEqual([3, 10n]);
  });
});

describe("Price rejection boundaries", () => {
  it.each([0n, 2n])("rejects unsupported version %s in both directions", (version) => {
    const price = { ...fixture(), version };
    const raw = priceToData(fixture());

    raw.fields[0] = version;
    expect(() => priceToData(price)).toThrow(/version/);
    expect(() => priceFromData(raw)).toThrow(/version/);
  });

  it.each([
    { assertions: [] },
    {
      assertions: Array.from({ length: 17 }, (_, i) => ({
        kind: "ConvertToAssets" as const,
        shares: BigInt(i),
        assets: 0n,
      })),
    },
  ])("rejects out-of-bound assertion lists", ({ assertions }) => {
    expect(() => priceToData({ ...fixture(), assertions })).toThrow(/count/);
  });

  it.each([550_000_000n, 700_000_000n])("rejects duplicate queries with result %s", (assets) => {
    const price = fixture();
    const duplicate: PriceAssertion = { kind: "ConvertToAssets", shares: 50_000_000_000n, assets };

    price.assertions.push(duplicate);
    expect(() => priceToData(price)).toThrow(/duplicate/);

    const raw = priceToData(fixture());
    const claims = raw.fields[4];

    expect(Array.isArray(claims)).toBe(true);

    if (!Array.isArray(claims)) throw new Error("fixture list");

    claims.push(constr(0, [duplicate.shares, assets]));
    expect(() => priceFromData(raw)).toThrow(/duplicate/);
  });

  it.each([constr(0, []), constr(1, []), 1n])("rejects bad envelope shape", (raw) => {
    expect(() => priceFromData(raw)).toThrow();
  });

  it("rejects extra envelope and assertion fields and unknown tags", () => {
    const extra = priceToData(fixture());

    extra.fields.push(0n);
    expect(() => priceFromData(extra)).toThrow(/arity/);

    for (const bad of [constr(0, [1n, 2n, 3n]), constr(6, [1n, 2n]), 1n]) {
      const raw = priceToData(fixture());

      raw.fields[4] = [bad];
      expect(() => priceFromData(raw)).toThrow();
    }
  });

  it("rejects malformed asset identities", () => {
    const raw = priceToData(fixture());

    raw.fields[1] = constr(1, [bytes("dd"), bytes("")]);
    expect(() => priceFromData(raw)).toThrow();
    expect(() => priceToData({ ...fixture(), shareAsset: { policy: "ee", name: "" } })).toThrow();
  });

  it("rejects negative, overflowing and number-valued quantities", () => {
    for (const input of [-1n, Q_MAX + 1n, 12]) {
      const raw = priceToData(fixture());

      raw.fields[4] = [constr(0, [input as bigint, 1n])];
      expect(() => priceFromData(raw)).toThrow();
    }
  });

  it("bounds evidence structure and normalized bytes", () => {
    const price = fixture();

    expect(() => priceToData({ ...price, evidence: new Uint8Array(1024) })).toThrow(/byte bound/);
    expect(() => priceToData({ ...price, evidence: Array(256).fill(0n) })).toThrow(/structural/);
    expect(() =>
      priceToData({
        ...price,
        evidence: {
          map: [
            [0n, 1n],
            [0n, 2n],
          ],
        },
      }),
    ).toThrow(/duplicate/);

    let deep = constr(0);

    for (let i = 0; i < 17; i++) deep = constr(0, [deep]);

    expect(() => priceToData({ ...price, evidence: deep })).toThrow(/structural/);
  });

  it("accepts a structurally valid lie, leaving economic truth to the provider", () => {
    const price = fixture();

    price.assertions = [{ kind: "ConvertToAssets", shares: 50_000_000_000n, assets: 700_000_000n }];
    expect(priceFromData(priceToData(price))).toEqual(price);
  });
});
