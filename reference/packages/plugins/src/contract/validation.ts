/** Small wire validators for collection discovery declarations. */
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("expected an object");

  return value as Record<string, unknown>;
}

export function hex(value: unknown, bytes: number): string {
  if (typeof value !== "string" || !new RegExp(`^[a-f0-9]{${bytes * 2}}$`).test(value))
    throw new Error("invalid canonical hash");

  return value;
}

export function unsigned(value: unknown, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > maximum)
    throw new Error("invalid unsigned integer");

  return value;
}

export function decimal(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9][0-9]*)$/.test(value) ||
    value.length > 20 ||
    BigInt(value) > 0xffffffffffffffffn
  )
    throw new Error("invalid uint64 decimal string");

  return value;
}
