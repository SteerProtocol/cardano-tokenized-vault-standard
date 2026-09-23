/** Uses real Lucid balancing to detect protected-output drift without executing a vault validator. */
import type { IndexedOutput } from "@ctvs/planning";
import { constr, enterprise } from "@ctvs/protocol";
import {
  Emulator,
  generateEmulatorAccountFromPrivateKey,
  getAddressDetails,
  Lucid,
} from "@lucid-evolution/lucid";
import { describe, expect, it } from "vitest";
import { assertProtectedOutputs } from "./outputs.js";
import { datumHex } from "./serialization.js";

async function balancedOutput(lovelace: bigint) {
  const account = generateEmulatorAccountFromPrivateKey({ lovelace: 100_000_000n });
  const lucid = await Lucid(new Emulator([account]), "Custom");

  lucid.selectWallet.fromPrivateKey(account.privateKey);

  const key = getAddressDetails(account.address).paymentCredential?.hash;

  if (!key) throw new Error("Missing fixture key");

  const datum = constr(999, []);
  const planned: IndexedOutput = {
    index: 0n,
    role: "request",
    address: enterprise(key, "key"),
    datum,
    datumMode: "inline",
    value: { ada: lovelace },
    referenceScript: null,
  };
  const built = await lucid
    .newTx()
    .pay.ToAddressWithData(
      account.address,
      { kind: "inline", value: datumHex(datum) },
      { lovelace },
    )
    .complete();

  return { cbor: built.toCBOR(), planned };
}

describe("protected output preservation", () => {
  it("rejects a real builder's implicit minimum-ADA increase before signing", async () => {
    const { cbor, planned } = await balancedOutput(1n);

    expect(() => assertProtectedOutputs(cbor, [planned])).toThrow(/value changed.*replan/);
  });

  it("accepts an exact output with explicit adequate reserve", async () => {
    const { cbor, planned } = await balancedOutput(5_000_000n);

    expect(() => assertProtectedOutputs(cbor, [planned])).not.toThrow();
  });

  it("rejects address, datum and index substitutions", async () => {
    const { cbor, planned } = await balancedOutput(5_000_000n);

    expect(() =>
      assertProtectedOutputs(cbor, [{ ...planned, address: enterprise("ff".repeat(28), "key") }]),
    ).toThrow(/address changed/);
    expect(() => assertProtectedOutputs(cbor, [{ ...planned, datum: constr(998, []) }])).toThrow(
      /datum changed/,
    );
    expect(() =>
      assertProtectedOutputs(cbor, [{ ...planned, datum: null, datumMode: "none" }]),
    ).toThrow(/unexpected datum/);
    expect(() => assertProtectedOutputs(cbor, [{ ...planned, index: 999n }])).toThrow(
      /missing protected output/,
    );
  });
});
