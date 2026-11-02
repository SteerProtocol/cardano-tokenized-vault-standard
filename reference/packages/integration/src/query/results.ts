/** Per-method response schemas. Raw protected sources keep original CBOR instead of decoding opaque economics. */
import {
  address,
  asset,
  deployment,
  destination,
  network,
  observation,
  outRef,
  point,
  state,
  terms,
} from "./domain.js";
import {
  array,
  boolean,
  type Codec,
  count,
  dictionary,
  fields,
  hex,
  integer,
  invalid,
  literal,
  nullable,
  object,
  optional,
  quantity,
  text,
} from "./schema.js";
import type { QueryResults } from "./types.js";

const physicalValue = dictionary(integer((1n << 64n) - 1n));
const value: Codec<Record<string, bigint>> = {
  encode: (v) => physicalValue.encode(v),
  decode(v) {
    const result = physicalValue.decode(v);

    if (
      Object.keys(result).some(
        (key) => key !== "ada" && !/^[a-f0-9]{56}\.(?:[a-f0-9]{2}){0,32}$/.test(key),
      )
    )
      invalid("invalid value asset identity");

    return result;
  },
};

export const rawInput = fields({
  ref: outRef,
  address,
  datumMode: literal("inline"),
  referenceScript: literal(null),
  value,
  datumCbor: hex(),
});
export const contextCodec = fields({ deployment, terms, stateInput: rawInput });

const recovery = fields({
  vaultPolicy: hex(28),
  controller: hex(28),
  refund: destination,
  deadlinePosixMs: quantity,
});
const body = fields({
  termsHash: hex(32),
  kind: literal("deposit", "redeem"),
  offered: quantity,
  minimumOutput: quantity,
  receiver: destination,
  storageLovelace: quantity,
  executionBudget: quantity,
  settlerFee: quantity,
});
const claim = fields({
  vaultPolicy: hex(28),
  requestRef: outRef,
  stateRef: outRef,
  termsHash: hex(32),
  asset,
  economicQuantity: quantity,
  receiver: destination,
  carriedLovelace: quantity,
});
const quote = fields({
  operation: literal("deposit", "mint", "withdraw", "redeem"),
  amount: quantity,
  grossAssets: quantity,
  netAssets: quantity,
  shares: quantity,
  fee: quantity,
  pricing: literal("exact_at_snapshot"),
  execution: literal("unchecked"),
});
const economic = fields({
  method: literal(
    "convertToAssets",
    "convertToShares",
    "previewDeposit",
    "previewMint",
    "previewWithdraw",
    "previewRedeem",
  ),
  amount: quantity,
  inputUnit: literal("assets", "shares"),
  outputUnit: literal("assets", "shares"),
  units: fields({ assets: asset, shares: text }),
  feeUnits: fields({
    protocol: asset,
    network: literal("lovelace"),
    settler: literal("lovelace"),
    executionCharge: literal("lovelace"),
    storage: literal("lovelace"),
    topups: literal("lovelace"),
  }),
  result: observation(quantity),
  quote: nullable(quote),
  pricing: literal("fee_free_at_snapshot", "exact_at_snapshot", "indicative_until_settlement"),
  availability: fields({
    status: literal("available", "unavailable", "unsupported", "not_applicable"),
    code: text,
  }),
  capabilities: fields({
    read: literal(true),
    construction: boolean,
    execution: literal("direct", "request", "unsupported", "not_applicable"),
  }),
  economicMaximum: observation(quantity),
  constructionMaximum: observation(quantity),
  protocolFeeDestination: destination,
  fees: fields({
    protocol: observation(quantity),
    network: observation(quantity),
    settler: observation(quantity),
    executionCharge: observation(quantity),
    storage: observation(quantity),
    topups: observation(quantity),
  }),
  construction: optional(contextCodec),
});

export const resultCodecs = {
  snapshot: fields({
    underlying: text,
    quantityUnit: literal("ledger_integer_quantity"),
    state,
    terms,
    backingAssets: observation(quantity),
    economicSupply: observation(quantity),
    excludedFees: observation(quantity),
    excludedReserve: observation(quantity),
    availableLiquidity: observation(quantity),
    executionModes: quantity,
    pauseFlags: quantity,
    pricing: literal("direct_custody_at_chain_point"),
    constructionCapacity: observation(quantity),
  }),
  convertToAssets: economic,
  convertToShares: economic,
  previewDeposit: economic,
  previewMint: economic,
  previewWithdraw: economic,
  previewRedeem: economic,
  ownership: fields({
    freeShares: quantity,
    lockedRedemptionShares: quantity,
    issuedUndeliveredShares: quantity,
    pendingDepositAssets: quantity,
    fixedAssetClaims: quantity,
    unsupportedRequests: count,
    controlledRequests: array(outRef),
    pendingEntitlement: literal("refund_destination"),
    scope: text,
  }),
  context: contextCodec,
  request: fields({
    ref: outRef,
    policy: hex(28),
    recovery,
    request: nullable(fields({ recovery, body })),
    created: point,
    status: literal("pending_escrow", "claimable", "delivered", "refunded"),
    settlement: nullable(fields({ txId: hex(32), stateRef: outRef, claimRef: outRef, point })),
    completion: nullable(fields({ txId: hex(32), output: outRef, point })),
    source: rawInput,
    unspent: boolean,
    validation: observation(boolean),
  }),
  claim: fields({ ref: outRef, claim, source: rawInput, unspent: boolean }),
  recoverySource: fields({ deployment, source: rawInput }),
} as { [K in keyof QueryResults]: Codec<QueryResults[K]> };

export const envelopeFields = {
  schema: literal("CTVS-INTEGRATION-0.6"),
  kind: literal("query"),
  network,
  chainPoint: point,
  vault: fields({ policy: hex(28), share: text, configRef: outRef }),
  implementation: fields({
    family: literal("ctvs1", "ctvs2"),
    buildId: text,
    profile: literal(0),
    wire: literal(2),
  }),
  claimedConformance: literal("profile-0-reference-semantics"),
  evidence: fields({ genesis: hex(32), state: outRef, termsHash: hex(32) }),
  verification: fields({
    disposition: literal("accepted_chain_and_reviewed_build"),
    consensusSource: literal("trusted_accepted_block_feed"),
    independentLedgerValidation: literal(false),
  }),
};

export function resultsCodec(keys: string[]): Codec<Record<string, unknown>> {
  return {
    decode(v) {
      return transform(v, "decode");
    },
    encode(v) {
      return transform(v, "encode");
    },
  };

  function transform(v: unknown, direction: "decode" | "encode") {
    const raw = object(v);

    if (Object.keys(raw).length !== keys.length || keys.some((key) => !Object.hasOwn(raw, key)))
      invalid("response query keys differ");

    return Object.fromEntries(
      keys.map((key) => {
        if (!Object.hasOwn(resultCodecs, key)) invalid("unknown result method");

        return [
          key,
          (resultCodecs[key as keyof QueryResults] as Codec<unknown>)[direction](raw[key]),
        ];
      }),
    );
  }
}
