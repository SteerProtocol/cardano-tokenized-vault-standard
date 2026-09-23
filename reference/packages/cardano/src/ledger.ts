/** Shared conversions between Lucid units/references and CTVS identities without changing asset-name bytes. */
import type { Value } from "@ctvs/planning";
import { assetId, type OutRef, refId } from "@ctvs/protocol";
import { type Assets, fromUnit, type OutRef as LucidOutRef, toUnit } from "@lucid-evolution/lucid";

/**
 * Convert Lucid's numeric output index to the protocol's bigint reference without
 * accepting fractional or unsafe numbers. Canonical protocol validation also checks
 * the transaction hash and supported index range; the returned hash is lowercase.
 */
export function protocolRef(ref: LucidOutRef): OutRef {
  if (!Number.isSafeInteger(ref.outputIndex)) throw new RangeError("invalid output index");

  const result = { txId: ref.txHash, index: BigInt(ref.outputIndex) };

  refId(result);

  return { ...result, txId: result.txId.toLowerCase() };
}

/**
 * Interpret a protocol key as ADA or exactly one policy/name pair, then delegate
 * byte-length and hexadecimal checks to the shared protocol validator. Empty native
 * asset names are valid; extra separators and odd-length names are not repaired.
 */
function normalizedAssetId(id: string): string {
  if (id === "ada") return id;

  const [policy, name, ...extra] = id.split(".");

  if (policy === undefined || name === undefined || extra.length !== 0)
    throw new TypeError("invalid asset identifier");

  return assetId({ policy, name });
}

/**
 * Return a fresh canonical asset map with explicit zero entries omitted and signed
 * bigint quantities preserved, including burns. Reject case-alias duplicates rather
 * than merging them, even if one alias carries zero. This adapter imposes no custody
 * sign or quantity bound; callers must apply the rule appropriate to their context.
 */
export function normalizedValue(value: Value): Value {
  const result: Value = {};
  const seen = new Set<string>();

  for (const [id, amount] of Object.entries(value)) {
    const key = normalizedAssetId(id);

    if (seen.has(key)) throw new Error("duplicate asset identifier");

    seen.add(key);

    if (typeof amount !== "bigint") throw new TypeError("asset quantity must be bigint");

    if (amount !== 0n) result[key] = amount;
  }

  return result;
}

/**
 * Convert canonical protocol identities to Lucid's lovelace/native-unit spelling.
 * Full name bytes and signed quantities pass through unchanged after normalization;
 * this representation adapter does not certify a valid output or balanced transaction.
 */
export function ledgerValue(value: Value): Assets {
  return Object.fromEntries(
    Object.entries(normalizedValue(value)).map(([id, amount]) => {
      if (id === "ada") return ["lovelace", amount];

      const [policy = "", name] = id.split(".");

      return [toUnit(policy, name), amount];
    }),
  );
}

/**
 * Convert observed Lucid asset units to normalized protocol identities without
 * interpreting asset names as text or removing CIP-67 labels. Delegate unit splitting
 * to Lucid, then enforce protocol identity and duplicate rules through normalizedValue.
 * Signed values are retained so the same adapter can represent mint and burn deltas.
 */
export function protocolValue(value: Assets): Value {
  return normalizedValue(
    Object.fromEntries(
      Object.entries(value).map(([unit, amount]) => {
        if (unit === "lovelace") return ["ada", amount];

        // assetName includes CIP-67 labels; fromUnit().name removes them.
        const { policyId, assetName } = fromUnit(unit);

        return [`${policyId}.${assetName ?? ""}`, amount];
      }),
    ),
  );
}
