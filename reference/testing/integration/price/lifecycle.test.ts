/** Real parameterized programs, signatures and final CBOR evaluation; local acceptance is not a node receipt. */
import * as p from "@ctvs/protocol";
import { describe, expect, it } from "vitest";
import { createPriceFixture } from "../../fixtures/price/index.js";
import { BACKING, RECEIPTS, SUPPLY, VALUE } from "../../fixtures/price/scripts.js";
import { only } from "../../ledger/serialization.js";

/** Cycle distinct queries across every method for the maximum-envelope fixture. */
function maximumAssertion(index: number): p.PriceAssertion {
  const amount = RECEIPTS + BigInt(index);

  switch (index % 6) {
    case 0:
      return { kind: "ConvertToAssets", shares: amount, assets: (amount * BACKING) / SUPPLY };
    case 1:
      return { kind: "ConvertToShares", assets: amount, shares: (amount * SUPPLY) / BACKING };
    case 2:
      return {
        kind: "PreviewDeposit",
        assetsIn: amount,
        sharesOut: (amount * SUPPLY) / BACKING,
      };
    case 3:
      return {
        kind: "PreviewMint",
        sharesOut: amount,
        assetsIn: (amount * BACKING + SUPPLY - 1n) / SUPPLY,
      };
    case 4:
      return {
        kind: "PreviewWithdraw",
        assetsOut: amount,
        sharesIn: (amount * SUPPLY + BACKING - 1n) / BACKING,
      };
    default:
      return {
        kind: "PreviewRedeem",
        sharesIn: amount,
        assetsOut: (amount * BACKING) / SUPPLY,
      };
  }
}

describe.each(["witness", "reference"] as const)("Price signed %s programs", (source) => {
  it("rejects an old evidence pointer and reprices against the replacement", async () => {
    const fixture = await createPriceFixture(`replaced-${source}`);
    const oldClaim = fixture.claim();
    const oldRef = { txHash: fixture.state.txHash, outputIndex: fixture.state.outputIndex };

    await fixture.replaceState();
    expect(await fixture.provider.getUtxosByOutRef([oldRef])).toEqual([]);
    await fixture.reject("old-evidence", fixture.checkpoint(source, oldClaim));
    await fixture.reject("old-result", fixture.checkpoint(source));

    const value = 500_000_000n;

    await fixture.submit(
      "repriced",
      fixture.checkpoint(
        source,
        fixture.claim([{ kind: "ConvertToAssets", shares: RECEIPTS, assets: value }]),
        value,
      ),
    );
  });
  it("verifies all six methods and preserves custody in observed output", async () => {
    const fixture = await createPriceFixture(source);
    // Include fractional exact-output queries so ceiling branches execute too.
    const assertions: p.PriceAssertion[] = [
      { kind: "ConvertToAssets", shares: RECEIPTS, assets: VALUE },
      { kind: "ConvertToShares", assets: 1n, shares: 90n },
      { kind: "PreviewDeposit", assetsIn: 1n, sharesOut: 90n },
      { kind: "PreviewMint", sharesOut: 100n, assetsIn: 2n },
      { kind: "PreviewWithdraw", assetsOut: 1n, sharesIn: 91n },
      { kind: "PreviewRedeem", sharesIn: 100n, assetsOut: 1n },
    ];
    const id = await fixture.submit(
      "checkpoint",
      fixture.checkpoint(source, fixture.claim(assertions)),
    );
    const result = only(
      await fixture.provider.getUtxosByOutRef([{ txHash: id, outputIndex: 0 }]),
      "Missing successor",
    );

    expect(result.assets).toEqual(fixture.position.assets);
    expect(p.decodeData(result.datum ?? "")).toEqual(p.constr(0, [VALUE]));

    const signed = fixture.evaluator.records.find(
      (r) => r.stage === "checkpoint" && r.phase === "signed",
    );

    expect(signed?.accepted).toBe(true);
    expect(signed?.redeemers?.map((r) => r.redeemer_tag).sort()).toEqual(["spend", "withdraw"]);
  });

  it("rejects a false claim and receipt diversion through compiled execution", async () => {
    const fixture = await createPriceFixture(`reject-${source}`);

    await fixture.reject(
      "false-price",
      fixture.checkpoint(
        source,
        fixture.claim([{ kind: "ConvertToAssets", shares: RECEIPTS, assets: VALUE + 1n }]),
        VALUE + 1n,
      ),
    );
    await fixture.reject(
      "custody-diversion",
      fixture.checkpoint(source, fixture.claim(), VALUE, RECEIPTS - 1n),
    );
    await fixture.reject(
      "missing-consumer-conversion",
      fixture.checkpoint(
        source,
        fixture.claim([{ kind: "PreviewRedeem", sharesIn: RECEIPTS, assetsOut: VALUE }]),
      ),
    );

    // Every new method must fail economically, even alongside the consumer's
    // correct conversion. Negative cases must reach compiled phase-two execution.
    const falseAssertions: p.PriceAssertion[] = [
      { kind: "ConvertToShares", assets: 1n, shares: 91n },
      { kind: "PreviewDeposit", assetsIn: 1n, sharesOut: 91n },
      { kind: "PreviewMint", sharesOut: 100n, assetsIn: 1n },
      { kind: "PreviewWithdraw", assetsOut: 1n, sharesIn: 90n },
      { kind: "PreviewRedeem", sharesIn: 100n, assetsOut: 2n },
    ];

    for (const assertion of falseAssertions) {
      await fixture.reject(
        `false-${assertion.kind}`,
        fixture.checkpoint(
          source,
          fixture.claim([{ kind: "ConvertToAssets", shares: RECEIPTS, assets: VALUE }, assertion]),
        ),
      );
    }
  });

  it("validates all 16 assertions under the current local transaction envelope", async () => {
    const fixture = await createPriceFixture(`maximum-${source}`);
    const assertions = Array.from({ length: 16 }, (_, index) => maximumAssertion(index));

    await fixture.submit("maximum", fixture.checkpoint(source, fixture.claim(assertions)));
  });
});
