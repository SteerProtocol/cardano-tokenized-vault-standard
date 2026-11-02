/** The same strict request codec serves HTTP validation and SDK serialization. */
import { address, outRef, point } from "./domain.js";
import {
  array,
  type Codec,
  count,
  fields,
  hex,
  invalid,
  literal,
  object,
  optional,
  quantity,
  text,
} from "./schema.js";

import {
  QUERY_BUDGET,
  QUERY_VERSION,
  type ReadQueries,
  type ReadRequest,
  type ViewBasis,
} from "./types.js";

export const parseVaultPolicy = (value: unknown): string => hex(28).decode(value);

export const basisCodec: Codec<ViewBasis> = fields({
  instance: text,
  recoveryGeneration: count,
  chainPoint: point,
  stateRef: outRef,
});

const inclusion = array(literal("construction"), 1);
const include = optional({
  encode: inclusion.encode,
  decode(value: unknown) {
    const parsed = inclusion.decode(value);

    if (parsed.length !== 1) invalid("include must contain construction");

    return parsed;
  },
});

export const queryInputs = {
  snapshot: literal(true),
  convertToAssets: fields({ shares: quantity }),
  convertToShares: fields({ assets: quantity }),
  previewDeposit: fields({ assets: quantity, include }),
  previewMint: fields({ shares: quantity, include }),
  previewWithdraw: fields({ assets: quantity, include }),
  previewRedeem: fields({ shares: quantity, include }),
  ownership: fields({ address }),
  context: literal(true),
  request: fields({ ref: outRef }),
  claim: fields({ ref: outRef }),
  recoverySource: fields({ ref: outRef }),
};

export const queriesCodec: Codec<ReadQueries> = {
  decode(value) {
    return queryFields(value, "decode");
  },
  encode(value) {
    return queryFields(value, "encode");
  },
};

function queryFields(value: unknown, direction: "decode" | "encode"): ReadQueries {
  const raw = object(value);
  const keys = Object.keys(raw);

  if (keys.length === 0 || keys.length > QUERY_BUDGET.subqueries)
    invalid("query count outside budget");

  return Object.fromEntries(
    keys.map((key) => {
      if (!Object.hasOwn(queryInputs, key)) invalid("unknown read method");

      const codec = queryInputs[key as keyof ReadQueries] as Codec<unknown>;
      const parsed = codec[direction](raw[key]);

      if (parsed === undefined) invalid("query field cannot be undefined");

      return [key, parsed];
    }),
  );
}

const requestCodec = fields({
  apiVersion: literal(QUERY_VERSION),
  queries: queriesCodec,
  expectedBasis: optional(basisCodec),
});

export function decodeReadRequest(value: unknown): ReadRequest {
  return requestCodec.decode(value) as ReadRequest;
}

export function encodeReadRequest(queries: ReadQueries, expectedBasis?: ViewBasis): string {
  const request = {
    apiVersion: QUERY_VERSION,
    queries,
    ...(expectedBasis ? { expectedBasis } : {}),
  };
  const encoded = requestCodec.encode(request);

  requestCodec.decode(encoded);

  return JSON.stringify(encoded);
}
