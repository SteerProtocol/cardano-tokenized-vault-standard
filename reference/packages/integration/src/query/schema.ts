/** Small codecs for this query contract. No field is inferred from its spelling or revived heuristically. */
export type QueryErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_RESPONSE"
  | "READER_NOT_READY"
  | "OUTSIDE_SCOPE"
  | "HISTORY_INCOMPLETE"
  | "NOT_FOUND"
  | "STALE_BASIS"
  | "UNSUPPORTED_CONSTRUCTION"
  | "QUERY_LIMIT"
  | "NETWORK_MISMATCH"
  | "INTERNAL_ERROR";

export class QueryError extends Error {
  constructor(
    readonly code: QueryErrorCode,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "QueryError";
  }
}

export interface Codec<T> {
  decode(value: unknown): T;
  encode(value: T): unknown;
}
export type Decoded<C> = C extends Codec<infer T> ? T : never;

export function invalid(message = "invalid query value"): never {
  throw new QueryError("INVALID_REQUEST", message);
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("expected an object");

  return value as Record<string, unknown>;
}

export function literal<const T extends string | number | boolean | null>(
  ...values: T[]
): Codec<T> {
  return {
    decode: (value) => (values.includes(value as T) ? (value as T) : invalid("unexpected literal")),
    encode: (value) => value,
  };
}

export const text: Codec<string> = {
  decode: (value) =>
    typeof value === "string" && value.length > 0 && value.length <= 4096
      ? value
      : invalid("expected bounded text"),
  encode: (value) => value,
};
export const count: Codec<number> = {
  decode: (value) =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0
      ? value
      : invalid("expected safe count"),
  encode: (value) => value,
};
export const boolean = literal(true, false);

export function integer(maximum = (1n << 63n) - 1n): Codec<bigint> {
  return {
    decode(value) {
      if (
        typeof value !== "string" ||
        value.length > maximum.toString().length ||
        !/^(0|[1-9][0-9]*)$/.test(value)
      )
        invalid("expected bounded decimal string");

      const result = BigInt(value);

      return result <= maximum ? result : invalid("integer exceeds domain");
    },
    encode(value) {
      if (typeof value !== "bigint" || value < 0n || value > maximum)
        invalid("expected bounded bigint");

      return value.toString();
    },
  };
}

export const quantity = integer();

export function hex(bytes?: number, maximumBytes = 131072): Codec<string> {
  return {
    decode(value) {
      if (
        typeof value !== "string" ||
        value.length > maximumBytes * 2 ||
        !/^(?:[a-f0-9]{2})*$/.test(value) ||
        (bytes !== undefined && value.length !== bytes * 2)
      )
        invalid("invalid hex");

      return value;
    },
    encode: (value) => value,
  };
}

export function nullable<T>(codec: Codec<T>): Codec<T | null> {
  return {
    decode: (v) => (v === null ? null : codec.decode(v)),
    encode: (v) => (v === null ? null : codec.encode(v)),
  };
}

export function optional<T>(codec: Codec<T>): Codec<T | undefined> {
  return {
    decode: (v) => (v === undefined ? undefined : codec.decode(v)),
    encode: (v) => (v === undefined ? undefined : codec.encode(v)),
  };
}

type Shape<S extends Record<string, Codec<unknown>>> = {
  [K in keyof S as undefined extends Decoded<S[K]> ? never : K]: Decoded<S[K]>;
} & {
  [K in keyof S as undefined extends Decoded<S[K]> ? K : never]?: Exclude<Decoded<S[K]>, undefined>;
};

export function array<T>(codec: Codec<T>, maximum = 20000): Codec<T[]> {
  return {
    decode: (v) =>
      Array.isArray(v) && v.length <= maximum
        ? v.map((item) => codec.decode(item))
        : invalid("invalid array"),
    encode: (v) => v.map((item) => codec.encode(item)),
  };
}

export function fields<const S extends Record<string, Codec<unknown>>>(shape: S): Codec<Shape<S>> {
  const transform = (value: unknown, direction: "decode" | "encode") => {
    const input = object(value);

    if (Object.keys(input).some((key) => !Object.hasOwn(shape, key)))
      invalid("unknown object field");

    return Object.fromEntries(
      Object.entries(shape)
        .map(([key, codec]) => [key, codec[direction](input[key])])
        .filter(([, v]) => v !== undefined),
    ) as Shape<S>;
  };

  return { decode: (v) => transform(v, "decode"), encode: (v) => transform(v, "encode") };
}

export function dictionary<T>(codec: Codec<T>): Codec<Record<string, T>> {
  const transform = (v: unknown, direction: "decode" | "encode") => {
    const entries = Object.entries(object(v));

    if (entries.length > 20000) invalid("too many dictionary entries");

    return Object.fromEntries(entries.map(([key, value]) => [key, codec[direction](value as T)]));
  };

  return {
    decode: (v) => transform(v, "decode") as Record<string, T>,
    encode: (v) => transform(v, "encode"),
  };
}
