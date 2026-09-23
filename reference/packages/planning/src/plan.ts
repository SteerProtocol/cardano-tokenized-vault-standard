/** Creates reviewable transaction intents with protected outputs and explicit unfinished ledger work. */
import type { Destination, OutRef, PlutusData } from "@ctvs/protocol";
import {
  addressData,
  assetData,
  credentialData,
  dataToJson,
  destinationData,
  encodeData,
  equalHex,
  hex,
  integer,
  outputIndex,
  Q_MAX,
  redeemerFromData,
  refId,
} from "@ctvs/protocol";
import { finiteValidity } from "./context.js";
import type {
  CreatePlan,
  InputRole,
  JsonValue,
  OutputRole,
  PlanInput,
  PlannedOutput,
  TransactionPlan,
  Value,
} from "./types.js";
import { actualValue } from "./value.js";

export function input(ref: OutRef, role: InputRole, redeemer: PlutusData | null = null): PlanInput {
  return { ref, role, redeemer };
}

/**
 * Build a protected output descriptor, validating its destination and normalizing custody value.
 * An omitted datum override preserves destination.datum; an explicit Data value replaces it.
 * Datum mode is derived from null versus inline Data, and reference scripts are forbidden.
 * No minimum-ADA balancing occurs; address/datum references are retained rather than deeply cloned.
 */
export function output(
  role: OutputRole,
  destination: Destination,
  amount: Value,
  datum?: PlutusData,
): PlannedOutput {
  destinationData(destination);

  const selectedDatum = datum === undefined ? destination.datum : datum;

  return {
    role,
    address: destination.address,
    datum: selectedDatum,
    datumMode: selectedDatum === null ? "none" : "inline",
    value: actualValue(amount),
    referenceScript: null,
  };
}

/**
 * Assemble and structurally validate an unsigned protocol intent with outputs indexed in supplied order.
 * Inputs, references and other supplied objects are retained; this is not an immutable approval snapshot.
 * Record the deployment/network claims and unresolved funding, collateral, balancing and evaluation work.
 * The returned object is explicitly not submit-ready and cannot authenticate its supplied chain evidence.
 */
export function createPlan(options: CreatePlan): TransactionPlan {
  const { operation, deployment, inputs, referenceInputs, outputs } = options;

  return validatePlan({
    schema: "CTVS-REFERENCE-PLAN-1",
    kind: "transaction_intent",
    operation,
    implementation: {
      family: deployment.family,
      profile: 0,
      wire: 2,
      buildId: deployment.buildId,
      policy: deployment.policy,
      configLock: deployment.configLock,
      claimScript: deployment.claimScript,
      termsHash: deployment.termsHash,
    },
    network: {
      name: deployment.network,
      domain: deployment.networkDomain,
      verifiedOnLedger: false,
    },
    chainPoint: deployment.chainPoint,
    inputs,
    referenceInputs,
    outputs: outputs.map((item, index) => ({ index: BigInt(index), ...item })),
    mint: options.mint ?? [],
    requiredSigners: options.requiredSigners ?? [],
    validity: options.validity ?? null,
    prohibitedPurposes: [
      "foreign_script_spends",
      "withdrawals",
      "certificates",
      "votes",
      "proposals",
      "treasury",
      "donations",
      "unrelated_mint",
    ],
    ledgerConstruction: {
      status: "not_constructed",
      signed: false,
      submitReady: false,
      unresolved: [
        "verify deployment/genesis/script bytes and all input evidence on chosen network",
        "select authorized key funding inputs and change",
        "balance actual protocol minimum ADA and fee",
        "select collateral and collateral return",
        "resolve validity slots from POSIX time",
        "attach reference scripts or witnesses outside protected outputs",
        "evaluate complete transaction against ledger protocol parameters",
        "verify all effects before signing",
      ],
    },
    fundingInputs: { status: "unselected" },
    change: { status: "unknown" },
    networkFee: { status: "unknown" },
    collateralExposure: { status: "unknown" },
  });
}

/**
 * Validate unique consumed references and the redeemer contract associated with each declared role.
 * The genesis seed is key-controlled and has no redeemer; every script input must decode for its role.
 * Return canonical consumed identities for overlap checks without resolving UTxOs or proving authority.
 */
function validateInputs(inputs: TransactionPlan["inputs"]): Set<string> {
  const consumed = new Set<string>();

  for (const source of inputs) {
    const id = refId(source.ref);

    if (consumed.has(id)) throw new Error("duplicate input");

    consumed.add(id);

    if (source.role === "genesis_seed") {
      if (source.redeemer !== null)
        throw new Error("key-controlled genesis seed cannot carry a script redeemer");
    } else {
      if (source.redeemer === null) throw new Error("script input requires its role redeemer");

      redeemerFromData(source.role, source.redeemer);
    }
  }

  return consumed;
}

/**
 * Keep read-only references disjoint from consumed inputs and unique within the reference list.
 * Identity comes from refId, so equivalent hex casing cannot bypass either check.
 * The supplied consumed set must already contain validated canonical keys from validateInputs.
 */
function validateReferences(
  referenceInputs: TransactionPlan["referenceInputs"],
  consumed: ReadonlySet<string>,
): void {
  const references = new Set<string>();

  for (const ref of referenceInputs) {
    const id = refId(ref);

    if (consumed.has(id) || references.has(id))
      throw new Error("overlapping or duplicate reference input");

    references.add(id);
  }
}

/**
 * Require contiguous declared indices and valid value/address/datum representations.
 * Inline-versus-absent datum mode must match its Data, and protected outputs cannot hold reference scripts.
 * This checks representation only; operation economics and final balanced-transaction preservation
 * are enforced by the operation planner and the complete-effects verifier.
 */
function validateOutputs(outputs: TransactionPlan["outputs"]): void {
  for (const [index, item] of outputs.entries()) {
    if (item.index !== BigInt(index)) throw new Error("invalid output index");

    outputIndex(item.index);
    actualValue(item.value);
    addressData(item.address);

    if (item.datum !== null) encodeData(item.datum);

    if (
      item.referenceScript !== null ||
      item.datumMode !== (item.datum === null ? "none" : "inline")
    )
      throw new Error("invalid protected output datum/script");
  }
}

/**
 * Restrict planned minting to the declared vault policy with bounded, nonzero signed quantities.
 * Validate asset-name syntax and the mint-role redeemer. Burns remain negative here, unlike custody.
 * The check does not derive permitted token names or supply deltas from the operation's economics.
 */
function validateMint(
  mints: TransactionPlan["mint"],
  implementation: TransactionPlan["implementation"],
): void {
  for (const mint of mints) {
    if (!equalHex(mint.policy, implementation.policy)) throw new Error("unrelated mint policy");

    for (const [name, amount] of Object.entries(mint.assets)) {
      assetData({ policy: mint.policy, name });
      integer(amount, "mint quantity", -Q_MAX, Q_MAX);

      if (amount === 0n) throw new Error("zero mint entries must be omitted");
    }

    redeemerFromData("mint", mint.redeemer);
  }
}

function validateSigners(requiredSigners: TransactionPlan["requiredSigners"]): void {
  for (const key of requiredSigners) credentialData({ type: "key", hash: key });

  if (new Set(requiredSigners.map((key) => key.toLowerCase())).size !== requiredSigners.length)
    throw new Error("duplicate signer");
}

/**
 * Check an intent's construction boundary, references, output shape, mint declarations and signer list.
 * Reject duplicate/overlapping inputs, wrong-role redeemers and invalid finite validity bounds.
 * Returns the same plan object without mutation. This is not a transaction balancer, operation-level
 * proof, deployment authenticator or guarantee that compiled validators will accept the plan.
 */
export function validatePlan<T extends TransactionPlan>(plan: T): T {
  if (
    plan.schema !== "CTVS-REFERENCE-PLAN-1" ||
    plan.kind !== "transaction_intent" ||
    plan.ledgerConstruction.status !== "not_constructed" ||
    plan.ledgerConstruction.submitReady !== false ||
    plan.ledgerConstruction.signed !== false
  )
    throw new Error("invalid intent construction boundary");

  const consumed = validateInputs(plan.inputs);

  validateReferences(plan.referenceInputs, consumed);
  validateOutputs(plan.outputs);
  validateMint(plan.mint, plan.implementation);
  validateSigners(plan.requiredSigners);

  if (plan.validity !== null) finiteValidity(plan.validity);

  return plan;
}

/**
 * Export validated review evidence as JSON-compatible values, with bigint encoded as decimal strings.
 * Byte arrays become hex; constructor/map Data objects include both structured Data and preferred CBOR.
 * Reject unsupported values rather than coercing them. This transport is not a signed transaction
 * and should not be treated as a round-trip decoder or an authoritative ledger representation.
 */
export function planToJson(plan: TransactionPlan): JsonValue {
  validatePlan(plan);

  /**
   * Within a plan, constructor/map objects denote semantic Data and receive dual JSON/CBOR evidence.
   * Ordinary arrays remain JSON arrays; this traversal is not a generic Data-JSON encoding pass.
   */
  function visit(item: unknown): JsonValue {
    if (typeof item === "bigint") return item.toString();

    if (item === null || typeof item === "string" || typeof item === "boolean") return item;

    if (typeof item === "number" && Number.isFinite(item)) return item;

    if (item instanceof Uint8Array) return hex(item);

    if (Array.isArray(item)) return item.map(visit);

    if (typeof item === "object") {
      if (Object.hasOwn(item, "constr") || Object.hasOwn(item, "map")) {
        const data = item as PlutusData;

        return { plutusData: visit(dataToJson(data)), cborHex: hex(encodeData(data)) };
      }

      return Object.fromEntries(Object.entries(item).map(([key, val]) => [key, visit(val)]));
    }

    throw new TypeError("plan contains a non-JSON value");
  }

  return visit(plan);
}
