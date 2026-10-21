/** Response data over one authenticated State; public reader methods attach and detach the common envelope. */
import {
  assetId,
  maxDeposit,
  type Operation,
  preview,
  stateFromData,
  transition,
} from "@ctvs/protocol";
import { economicView } from "../economics.js";
import { QueryError } from "../query/schema.js";
import type {
  ConstructionContext,
  EconomicMethod,
  PreviewInput,
  ShareInput,
} from "../query/types.js";
import type { Observation, VaultRecord } from "../types.js";

const known = <T>(value: T): Observation<T> => ({ status: "known", value });

const unknown = (reason: string): Observation<never> => ({ status: "unknown", reason });

export function snapshotData(vault: VaultRecord) {
  const state = stateFromData(vault.state.datum);

  return {
    underlying: assetId(vault.terms.underlying),
    quantityUnit: "ledger_integer_quantity",
    state,
    terms: vault.terms,
    backingAssets: known(state.backingAssets),
    economicSupply: known(state.economicSupply),
    excludedFees: known(state.accruedFees),
    excludedReserve: known(state.storageLovelace),
    availableLiquidity: known(state.backingAssets),
    executionModes: vault.terms.executionModes,
    pauseFlags: state.pauseFlags,
    pricing: "direct_custody_at_chain_point",
    constructionCapacity: unknown(
      "requires current protocol parameters and evaluation of the complete transaction",
    ),
  };
}

export function quoteData(vault: VaultRecord, operation: Operation, amount: bigint) {
  const state = stateFromData(vault.state.datum);
  const asynchronous = vault.deployment.family === "ctvs2";
  const quote = preview(operation, amount, state, vault.terms);
  let availability: Observation<boolean>;

  try {
    transition(
      operation,
      amount,
      operation === "mint" ? quote.grossAssets : operation === "withdraw" ? quote.shares : 1n,
      state,
      vault.terms,
      { asynchronous },
    );
    availability = known(true);
  } catch (error) {
    availability = {
      status: "unsupported",
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    operation,
    amount,
    result: known(quote),
    availability,
    pricingBasis: vault.state.ref,
    pricing: asynchronous ? "indicative_until_settlement" : "exact_at_snapshot",
    economicMaximum:
      operation === "deposit"
        ? maxDeposit(state, vault.terms, { asynchronous })
        : unknown("no operation-specific maximum solver exposed"),
    constructionMaximum: unknown("complete transaction evaluation required"),
    fees: {
      protocol: known(quote.fee),
      network: unknown("not constructed"),
      settler: asynchronous
        ? unknown("Request-specific fee")
        : { status: "not_applicable", reason: "direct operation" },
    },
    expiry: { invalidatedBy: "State consumption or rollback", stateRef: vault.state.ref },
    prerequisites: [
      "unspent State at the stated chain point",
      "user bound and destination",
      "wallet funding and witnesses",
      "ledger-valid constructed transaction",
    ],
  };
}

export function economicData(
  vault: VaultRecord,
  method: EconomicMethod,
  input: PreviewInput | ShareInput,
  construction: () => ConstructionContext,
) {
  const amount = "assets" in input ? input.assets : input.shares;
  const data = economicView(
    method,
    amount,
    stateFromData(vault.state.datum),
    vault.terms,
    vault.deployment.family === "ctvs2",
  );

  if (input.include?.includes("construction")) {
    if (!data.capabilities.construction)
      throw new QueryError(
        "UNSUPPORTED_CONSTRUCTION",
        "method has no supported construction path",
        422,
      );

    data.construction = construction();
  }

  return data;
}
