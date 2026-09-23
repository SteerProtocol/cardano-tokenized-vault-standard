/** Harness adapters reuse canonical value/reference conversion and encode addresses for the Custom test network. */
import type { Address, PlutusData } from "@ctvs/protocol";
import { encodeData, hex } from "@ctvs/protocol";
import { credentialToAddress } from "@lucid-evolution/lucid";

export { ledgerValue, protocolRef as asRef, protocolValue } from "@ctvs/cardano";

export const datumHex = (data: PlutusData): string => hex(encodeData(data));

export function ledgerAddress(address: Address): string {
  const payment = {
    type: address.payment.type === "key" ? ("Key" as const) : ("Script" as const),
    hash: address.payment.hash,
  };
  const stake =
    address.stake === null
      ? undefined
      : {
          type: address.stake.type === "key" ? ("Key" as const) : ("Script" as const),
          hash: address.stake.hash,
        };

  return credentialToAddress("Custom", payment, stake);
}

export function only<T>(values: T[], reason: string): T {
  const found = values[0];

  if (values.length !== 1 || found === undefined) throw new Error(reason);

  return found;
}
