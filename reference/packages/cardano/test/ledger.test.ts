/** Guards byte-exact asset identity, signed mint quantities and reference bounds at the Lucid adapter boundary. */
import { assetId, refId } from "@ctvs/protocol";
import { toUnit } from "@lucid-evolution/lucid";
import { describe, expect, it } from "vitest";
import { ledgerValue, normalizedValue, protocolRef, protocolValue } from "../src/ledger.js";

const policy = "ab".repeat(28);

describe("Cardano asset and reference adapters", () => {
  it("preserves CIP-67 labels, empty and maximum-length names, and signed burn quantities", () => {
    // The labels distinguish separate assets even when their unlabelled payload is identical.
    // Negative quantities exercise the mint representation, not legal output custody.
    const referenceToken = toUnit(policy, "cafe", 100);
    const userToken = toUnit(policy, "cafe", 222);
    const assets = {
      lovelace: 3_000_000n,
      [referenceToken]: 1n,
      [userToken]: -2n,
      [policy]: 4n,
      [policy + "ff".repeat(32)]: 5n,
    };

    expect(protocolValue(assets)).toEqual({
      ada: 3_000_000n,
      [assetId({ policy, name: "000643b0cafe" })]: 1n,
      [assetId({ policy, name: "000de140cafe" })]: -2n,
      [assetId({ policy, name: "" })]: 4n,
      [assetId({ policy, name: "ff".repeat(32) })]: 5n,
    });
    expect(ledgerValue(protocolValue(assets))).toEqual(assets);
  });

  it("canonicalizes hexadecimal identity and omits zero quantities without mutating input", () => {
    const id = `${policy}.cafe`,
      value = { [id.toUpperCase()]: -3n, ada: 0n };

    expect(normalizedValue(value)).toEqual({ [id]: -3n });
    expect(ledgerValue(value)).toEqual({ [`${policy}cafe`]: -3n });
    expect(protocolValue({ [`${policy}cafe`.toUpperCase()]: -3n })).toEqual({ [id]: -3n });
    expect(value).toEqual({ [id.toUpperCase()]: -3n, ada: 0n });
  });

  it.each([
    `${policy}.a`,
    `${policy}.gg`,
    `${policy}.${"00".repeat(33)}`,
    "11.",
    policy,
    `${policy}..00`,
  ])("rejects malformed protocol asset %s through canonical validation", (id) => {
    expect(() => normalizedValue({ [id]: 1n })).toThrow();
    expect(() => ledgerValue({ [id]: 1n })).toThrow();
  });

  it.each([`${policy}a`, `${policy}gg`, policy + "00".repeat(33), "11"])(
    "rejects malformed Lucid unit %s",
    (unit) => expect(() => protocolValue({ [unit]: 1n })).toThrow(),
  );

  it.each([0n, 1n])("rejects case aliases even when the first quantity is %s", (amount) => {
    // A zero alias must be rejected before zero removal, or a duplicate identity can disappear.
    const id = `${policy}.cafe`;

    expect(() => normalizedValue({ [id]: amount, [id.toUpperCase()]: 2n })).toThrow(/duplicate/);

    const unit = `${policy}cafe`;

    expect(() => protocolValue({ [unit]: amount, [unit.toUpperCase()]: 2n })).toThrow(/duplicate/);
  });

  it("rejects numeric quantities at the runtime boundary", () => {
    // @ts-expect-error Untrusted callers can supply numbers despite the public bigint type.
    expect(() => normalizedValue({ ada: 1 })).toThrow(/bigint/);
  });

  it("uses canonical transaction identities and the protocol output-index bounds", () => {
    const txHash = "AB".repeat(32);
    const ref = protocolRef({ txHash, outputIndex: 65_535 });

    expect(ref).toEqual({ txId: txHash.toLowerCase(), index: 65_535n });
    expect(refId(ref)).toBe(`${txHash.toLowerCase()}#65535`);

    for (const outputIndex of [-1, 65_536, 1.5, Number.MAX_SAFE_INTEGER + 1])
      expect(() => protocolRef({ txHash, outputIndex })).toThrow();

    expect(() => protocolRef({ txHash: "11", outputIndex: 0 })).toThrow();
    // @ts-expect-error Numeric strings are not Lucid output indices.
    expect(() => protocolRef({ txHash, outputIndex: "1" })).toThrow();
  });
});
