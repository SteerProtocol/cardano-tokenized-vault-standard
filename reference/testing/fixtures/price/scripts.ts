/** Bind the isolated adapter to real compiled scripts and an issuer-controlled test market. */
import { join } from "node:path";
import * as p from "@ctvs/protocol";
import {
  applyParamsToScript,
  Data,
  type Script,
  validatorToAddress,
  validatorToScriptHash,
} from "@lucid-evolution/lucid";
import { findValidator, readBlueprint, referenceRoot } from "../../../tools/lib/project.js";
import { datumHex } from "../../ledger/serialization.js";

export const RECEIPTS = 50_000_000_000n; // 500 receipts, eight decimals.
export const BACKING = 1_100_000_000_000n; // 1,100,000 underlying, six decimals.
export const SUPPLY = 100_000_000_000_000n; // 1,000,000 receipts.
export const VALUE = (RECEIPTS * BACKING) / SUPPLY; // 550 underlying.

export function priceScripts(policy: string, nativeState: Script) {
  const market = { policy, name: p.hex(Buffer.from("MARKET")) };
  const receipt = { policy, name: p.hex(Buffer.from("RECEIPT")) };
  const underlying = { policy, name: p.hex(Buffer.from("USDCX")) };
  const stateHash = validatorToScriptHash(nativeState);
  const config = p.constr(0, [
    p.assetData(market),
    p.assetData(receipt),
    p.assetData(underlying),
    p.addressData(p.enterprise(stateHash)),
  ]);
  const blueprint = readBlueprint(join(referenceRoot, "artifacts/price-provider/blueprint.json"));
  const provider: Script = {
    type: "PlutusV3",
    script: applyParamsToScript(
      findValidator(blueprint, "lending_a_price.lending_a_price.withdraw").compiledCode,
      [Data.from<Data>(datumHex(config))],
    ),
  };
  const providerHash = validatorToScriptHash(provider);
  const consumer: Script = {
    type: "PlutusV3",
    script: applyParamsToScript(
      findValidator(blueprint, "receipt_consumer.receipt_consumer.spend").compiledCode,
      [
        providerHash,
        ...[market, receipt, underlying].map((asset) =>
          Data.from<Data>(datumHex(p.assetData(asset))),
        ),
      ],
    ),
  };

  return {
    nativeState,
    provider,
    providerHash,
    consumer,
    market,
    receipt,
    underlying,
    stateAddress: validatorToAddress("Custom", nativeState),
    consumerAddress: validatorToAddress("Custom", consumer),
  };
}
