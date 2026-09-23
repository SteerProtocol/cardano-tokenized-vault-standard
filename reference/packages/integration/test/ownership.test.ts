/** Checks full-address entitlement so shared payment credentials cannot merge distinct Cardano ownership destinations. */
import { type Address, NAMES } from "@ctvs/protocol";
import { assetsToValue, CML, getAddressDetails, withCMLScope } from "@lucid-evolution/lucid";
import { expect, it } from "vitest";
import { ledgerAddress } from "../../../testing/ledger/serialization.js";
import { readerFixture } from "./fixtures.js";

function appendShares(
  f: ReturnType<typeof readerFixture>,
  allocations: readonly { address: string; shares: bigint }[],
): void {
  // Synthetic accepted outputs isolate ownership projection, without claiming ledger validation.
  const cbor = withCMLScope((own) => {
    const inputs = own(CML.TransactionInputList.new());
    const outputs = own(CML.TransactionOutputList.new());

    for (const { address, shares } of allocations)
      outputs.add(
        own(
          CML.TransactionOutput.new(
            own(CML.Address.from_bech32(address)),
            own(assetsToValue({ lovelace: 2_000_000n, [`${f.policy}${NAMES.share}`]: shares })),
          ),
        ),
      );

    const body = own(CML.TransactionBody.new(inputs, outputs, 1_000_000n));

    return own(CML.Transaction.new(body, own(CML.TransactionWitnessSet.new()), true)).to_cbor_hex();
  });

  f.reader.rollForward(f.block([cbor]));
}

it("does not attribute Pointer-address SHARE to an enterprise owner with the same payment key", () => {
  const f = readerFixture();
  const pointerAddress = withCMLScope((own) => {
    // Type 4 is a key payment credential with a pointer stake reference. The pointer is (0, 0, 0).
    const header = (0x40 | f.network.networkId).toString(16).padStart(2, "0");
    const address = own(CML.Address.from_hex(`${header}${f.owner.payment.hash}000000`));

    expect(own(CML.PointerAddress.from_address(address))).toBeDefined();

    return address.to_bech32();
  });
  const details = getAddressDetails(pointerAddress);

  expect(details.type).toBe("Pointer");
  expect(details.paymentCredential?.hash).toBe(f.owner.payment.hash);
  expect(details.stakeCredential).toBeUndefined();

  appendShares(f, [
    { address: pointerAddress, shares: 111n },
    { address: ledgerAddress(f.owner), shares: 7n },
  ]);

  expect(f.reader.ownership(f.policy, f.owner).data.freeShares).toBe(7n);
});

it("attributes free SHARE only to the full enterprise or base payment and stake credentials", () => {
  const f = readerFixture();
  const keyStake: Address = {
    payment: f.owner.payment,
    stake: { type: "key", hash: "ab".repeat(28) },
  };
  const otherStake: Address = {
    ...keyStake,
    stake: { type: "key", hash: "cd".repeat(28) },
  };
  const scriptStake: Address = {
    ...keyStake,
    stake: { type: "script", hash: "ab".repeat(28) },
  };
  const otherPayment: Address = {
    ...keyStake,
    payment: { type: "key", hash: "ef".repeat(28) },
  };
  const owners: readonly (readonly [Address, bigint])[] = [
    [f.owner, 7n],
    [keyStake, 11n],
    [otherStake, 13n],
    [scriptStake, 17n],
    [otherPayment, 19n],
  ];

  appendShares(
    f,
    owners.map(([owner, shares]) => ({ address: ledgerAddress(owner), shares })),
  );

  for (const [owner, shares] of owners)
    expect(f.reader.ownership(f.policy, owner).data.freeShares).toBe(shares);
});
