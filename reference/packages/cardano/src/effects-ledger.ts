/** Ledger comparisons for wallet review. CML owns serialization; these helpers enforce profile restrictions. */
import type { Value } from "@ctvs/planning";
import type { Address, PlutusData } from "@ctvs/protocol";
import { assetId, encodeData, hex, refId } from "@ctvs/protocol";
import {
  CML,
  coreToOutRef,
  coreToTxOutput,
  credentialToAddress,
  type Script,
  toScriptRef,
  withCMLScope,
} from "@lucid-evolution/lucid";
import type { AuthorizedDatum, AuthorizedOutput } from "./effects-types.js";
import { normalizedValue, protocolRef, protocolValue } from "./ledger.js";

export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Transaction effects: ${message}`);
}

/**
 * Normalize inline Data through CML for wallet-effect comparison, failing on invalid
 * CBOR. Return plain hex after releasing the decoded object. This is deliberately
 * separate from the profile's preferred encoding used for CTVS commitment hashes.
 */
export function canonicalData(cbor: string): string {
  return withCMLScope((own) => own(CML.PlutusData.from_cbor_hex(cbor)).to_canonical_cbor_hex());
}

/**
 * Translate protocol intent into the output datum modes supported by a plan.
 * Null means no datum, never a datum hash; non-null Data becomes inline CBOR using
 * the protocol encoder. Output matching later applies its own comparison normalization.
 */
export function plannedDatum(data: PlutusData | null): AuthorizedDatum {
  return data === null ? { kind: "none" } : { kind: "inline", cbor: hex(encodeData(data)) };
}

/**
 * Add the wallet-authorized network header to a semantic protocol address through
 * Lucid. Optional stake credentials remain part of the address. Network ID 0 alone
 * does not identify which test network is intended; that binding lives in authorization.
 */
export function plannedAddress(address: Address, networkId: 0 | 1): string {
  const credential = (value: Address["payment"]) => ({
    type: value.type === "key" ? ("Key" as const) : ("Script" as const),
    hash: value.hash,
  });

  return credentialToAddress(
    networkId === 1 ? "Mainnet" : "Custom",
    credential(address.payment),
    address.stake === null ? undefined : credential(address.stake),
  );
}

/**
 * Decode a payment address, reject a different network or unsupported address kind,
 * and return byte identity plus its payment key/script hash. Only base and enterprise
 * forms are supported here; the full bytes retain stake credentials for comparisons.
 * All CML handles are local and no ownership or spendability is inferred.
 */
export function addressInfo(
  address: string,
  networkId: number,
): { bytes: string; key: string | null; script: string | null } {
  return withCMLScope((own) => {
    const decoded = own(CML.Address.from_bech32(address));

    check(decoded.network_id() === networkId, "address belongs to another network");
    check(
      decoded.kind() === CML.AddressKind.Base || decoded.kind() === CML.AddressKind.Enterprise,
      "only base and enterprise payment addresses are supported",
    );

    const credential = decoded.payment_cred();

    check(credential, "missing payment credential");
    own(credential);

    const key = credential.as_pub_key(),
      script = credential.as_script();

    return {
      bytes: decoded.to_hex(),
      key: key ? own(key).to_hex() : null,
      script: script ? own(script).to_hex() : null,
    };
  });
}

/**
 * Take ownership of an optional CML input list and return canonical reference IDs
 * in its observed order. Reject duplicate references and invalid protocol index/hash
 * forms; an absent list becomes empty. Callers must not reuse the consumed list handle.
 */
export function readRefs(list: CML.TransactionInputList | undefined): string[] {
  if (!list) return [];

  return withCMLScope((own) => {
    own(list);

    const result: string[] = [];

    for (let index = 0; index < list.len(); index++) {
      const input = own(list.get(index));

      result.push(refId(protocolRef(coreToOutRef(input))));
    }

    check(new Set(result).size === result.length, "duplicate transaction input");

    return result;
  });
}

/**
 * Compare normalized asset maps independent of spelling case and explicit zeros.
 * Signed deltas remain valid, while malformed keys, case aliases or non-bigint
 * quantities throw instead of being treated as an ordinary unequal comparison.
 */
export function sameValue(left: Value, right: Value): boolean {
  const a = normalizedValue(left),
    b = normalizedValue(right);

  return (
    Object.keys(a).length === Object.keys(b).length &&
    Object.entries(a).every(([id, quantity]) => b[id] === quantity)
  );
}

/**
 * Mutate the caller's balance accumulator with normalized signed source quantities.
 * Callers supply a canonical target and use direction 1 for inputs/mint or -1 for
 * outputs/fees. Intermediate negatives and zeros remain until the final equation check.
 */
export function addValue(target: Value, source: Value, direction = 1n): void {
  for (const [id, quantity] of Object.entries(normalizedValue(source)))
    target[id] = (target[id] ?? 0n) + direction * quantity;
}

/**
 * Compare reference scripts by CML's canonical serialized script object, preserving
 * both language and program content. An absent script only matches another absence;
 * this checks content equality without executing either program.
 */
function sameScript(actual: Script | null, expected: Script | null): boolean {
  if (actual === null || expected === null) return actual === expected;

  return withCMLScope(
    (own) =>
      own(toScriptRef(actual)).to_canonical_cbor_hex() ===
      own(toScriptRef(expected)).to_canonical_cbor_hex(),
  );
}

/**
 * Project an observed CML output into plain review data without deciding whether it
 * is authorized. Preserve datum mode and reference script along with all assets;
 * the caller keeps ownership of the output and the result contains no WASM handles.
 */
export function readOutput(output: CML.TransactionOutput): AuthorizedOutput {
  const actual = coreToTxOutput(output);

  return {
    address: actual.address,
    value: protocolValue(actual.assets),
    datum:
      actual.datum != null
        ? { kind: "inline", cbor: actual.datum }
        : actual.datumHash != null
          ? { kind: "hash", hash: actual.datumHash }
          : { kind: "none" },
    referenceScript: actual.scriptRef ?? null,
  };
}

/**
 * Require the same datum mode before comparing content. Inline Data uses CML's
 * canonical representation and hashes compare as hex identities; neither path
 * substitutes inline content for a hash or validates a datum against a CTVS role.
 */
export function sameDatum(actual: AuthorizedDatum, expected: AuthorizedDatum): boolean {
  if (actual.kind !== expected.kind) return false;

  if (actual.kind === "inline" && expected.kind === "inline")
    return canonicalData(actual.cbor) === canonicalData(expected.cbor);

  if (actual.kind === "hash" && expected.kind === "hash")
    return actual.hash.toLowerCase() === expected.hash.toLowerCase();

  return true;
}

/**
 * Compare every authorized output component: full address bytes, complete value,
 * datum mode/content and reference script. Amount padding is therefore a mismatch.
 * Address/network or representation errors may throw; false means well-formed
 * compared components differ, not permission to send the output elsewhere.
 */
export function sameOutput(
  actual: AuthorizedOutput,
  expected: AuthorizedOutput,
  networkId: number,
): boolean {
  return (
    addressInfo(actual.address, networkId).bytes ===
      addressInfo(expected.address, networkId).bytes &&
    sameValue(actual.value, expected.value) &&
    sameDatum(actual.datum, expected.datum) &&
    sameScript(actual.referenceScript, expected.referenceScript)
  );
}

/**
 * Consume optional CML mint data into signed protocol asset deltas and sorted policy
 * IDs used by mint redeemer pointers. Preserve burns and full asset-name bytes while
 * rejecting explicit zero quantities. Absence is an empty mint; the caller must not
 * reuse a supplied mint handle after this function releases it.
 */
export function readMint(mint: CML.Mint | undefined): { value: Value; policies: string[] } {
  if (!mint) return { value: {}, policies: [] };

  return withCMLScope((own) => {
    own(mint);

    const policies = own(mint.keys()),
      result: Value = {},
      ids: string[] = [];

    for (let index = 0; index < policies.len(); index++) {
      const policy = own(policies.get(index)),
        assets = mint.get_assets(policy);

      check(assets, "missing mint policy assets");
      own(assets);

      const names = own(assets.keys());

      ids.push(policy.to_hex());

      for (let j = 0; j < names.len(); j++) {
        const name = own(names.get(j)),
          quantity = assets.get(name);

        check(quantity !== undefined && quantity !== 0n, "invalid mint quantity");
        result[assetId({ policy: policy.to_hex(), name: name.to_hex() })] = quantity;
      }
    }

    return { value: result, policies: ids.sort() };
  });
}

/**
 * Borrow a witness set and serialize a canonical copy containing every supported
 * non-vkey witness field. Script bytes, datum witnesses, redeemers and execution
 * units are included, so post-approval signing cannot change them undetected.
 * Vkey witnesses are omitted because signatures are added and checked separately.
 */
export function nonKeyWitnessCbor(witnesses: CML.TransactionWitnessSet): string {
  return withCMLScope((own) => {
    const result = own(CML.TransactionWitnessSet.new());

    const copy = <T extends { free(): void }>(value: T | undefined, set: (v: T) => void) => {
      if (value) set(own(value));
    };

    copy(witnesses.bootstrap_witnesses(), (v) => result.set_bootstrap_witnesses(v));
    copy(witnesses.native_scripts(), (v) => result.set_native_scripts(v));
    copy(witnesses.plutus_v1_scripts(), (v) => result.set_plutus_v1_scripts(v));
    copy(witnesses.plutus_v2_scripts(), (v) => result.set_plutus_v2_scripts(v));
    copy(witnesses.plutus_v3_scripts(), (v) => result.set_plutus_v3_scripts(v));
    copy(witnesses.plutus_datums(), (v) => result.set_plutus_datums(v));
    copy(witnesses.redeemers(), (v) => result.set_redeemers(v));

    return result.to_canonical_cbor_hex();
  });
}
