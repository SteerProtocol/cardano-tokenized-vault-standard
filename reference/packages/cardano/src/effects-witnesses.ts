/** Matches planned Plutus V3 execution to ledger redeemer pointers and available script witnesses. */
import type { TransactionPlan } from "@ctvs/planning";
import { refId } from "@ctvs/protocol";
import { CML, validatorToScriptHash, withCMLScope } from "@lucid-evolution/lucid";
import { addressInfo, canonicalData, check, plannedDatum } from "./effects-ledger.js";
import type { ResolvedEffectInput, VerifiedTransactionEffects } from "./effects-types.js";

/**
 * Derive expected redeemer pointers/Data and script hashes from planned execution,
 * using already-resolved input addresses as the script-identity evidence. Spend
 * pointers index all canonical body inputs, including funding; mint pointers index
 * policy IDs. A key-controlled genesis seed needs no redeemer. A null plan yields
 * no script requirements, so later matching cannot admit unplanned execution.
 */
function plannedWitnessRequirements(
  plan: TransactionPlan | null,
  inputRefs: string[],
  mintPolicies: string[],
  resolved: Map<string, ResolvedEffectInput>,
  networkId: number,
) {
  const expected = new Map<string, string>();
  const neededScripts = new Set<string>();
  // Ledger redeemer pointers index the canonical input/policy sets, not output order.
  const sortedInputs = [...inputRefs].sort((left, right) => {
    const [aHash, aIndex] = left.split("#"),
      [bHash, bIndex] = right.split("#");

    return aHash === bHash
      ? Number(BigInt(aIndex ?? "0") - BigInt(bIndex ?? "0"))
      : (aHash ?? "").localeCompare(bHash ?? "");
  });

  for (const source of plan?.inputs ?? []) {
    const id = refId(source.ref),
      input = resolved.get(id);

    check(input, "missing resolved plan input");

    const address = addressInfo(input.address, networkId);

    if (source.redeemer === null) check(address.key !== null, "genesis seed is not key controlled");
    else {
      const script =
        source.role === "claim" ? plan?.implementation.claimScript : plan?.implementation.policy;

      check(address.script === script?.toLowerCase(), "plan input script identity changed");
      neededScripts.add(address.script);

      const datum = plannedDatum(source.redeemer);

      check(datum.kind === "inline", "missing plan redeemer");
      expected.set(`0:${sortedInputs.indexOf(id)}`, canonicalData(datum.cbor));
    }
  }

  for (const mint of plan?.mint ?? []) {
    const policy = mint.policy.toLowerCase(),
      datum = plannedDatum(mint.redeemer);

    check(datum.kind === "inline", "missing mint redeemer");
    check(!expected.has(`1:${mintPolicies.indexOf(policy)}`), "duplicate planned mint policy");
    expected.set(`1:${mintPolicies.indexOf(policy)}`, canonicalData(datum.cbor));
    neededScripts.add(policy);
  }

  return { expected, neededScripts };
}

/**
 * Match actual redeemers to expected purpose/index/Data through CML's common flat
 * representation, accepting either supported collection encoding. Consume the
 * supplied expected map so duplicates and omissions fail, then return plain review
 * records including observed execution budgets. Budgets are reported and later bound
 * by approval, not measured or validated by this function. Borrow the witness set.
 */
function verifyRedeemers(
  witnesses: CML.TransactionWitnessSet,
  expected: Map<string, string>,
): VerifiedTransactionEffects["redeemers"] {
  return withCMLScope((own) => {
    const review: VerifiedTransactionEffects["redeemers"] = [];
    const redeemers = witnesses.redeemers();

    if (redeemers) {
      own(redeemers);

      const flat = own(redeemers.to_flat_format());

      check(flat.len() === expected.size, "unexpected or missing redeemer");

      for (let i = 0; i < flat.len(); i++) {
        const item = own(flat.get(i)),
          key = `${item.tag()}:${item.index()}`;

        check(
          expected.get(key) === own(item.data()).to_canonical_cbor_hex(),
          "redeemer purpose, index or data changed",
        );
        expected.delete(key);

        const units = own(item.ex_units());

        review.push({
          purpose: item.tag() === CML.RedeemerTag.Spend ? "spend" : "mint",
          index: item.index(),
          dataCbor: own(item.data()).to_canonical_cbor_hex(),
          memory: units.mem(),
          steps: units.steps(),
        });
      }
    }

    check(expected.size === 0, "missing planned redeemer");

    return review;
  });
}

/**
 * Require every planned script hash to be available either as an attached V3 program
 * or in an authorized reference UTxO actually named in the body. Reject unrelated
 * attached programs; extra authorized reference inputs may carry other programs.
 * Reference-script contents are trusted UTxO evidence, not authenticated here, and
 * matching a hash does not execute the program or establish its success.
 */
function verifyScriptAvailability(
  witnesses: CML.TransactionWitnessSet,
  neededScripts: Set<string>,
  references: Map<string, ResolvedEffectInput>,
  actualReferences: string[],
): void {
  withCMLScope((own) => {
    const scripts = witnesses.plutus_v3_scripts(),
      available = new Set<string>();

    if (scripts) {
      own(scripts);

      for (let i = 0; i < scripts.len(); i++) {
        const script = own(scripts.get(i)),
          hash = own(script.hash()).to_hex();

        check(neededScripts.has(hash), "unapproved Plutus script witness");
        available.add(hash);
      }
    }

    for (const id of actualReferences) {
      const script = references.get(id)?.referenceScript;

      if (script) available.add(validatorToScriptHash(script));
    }

    for (const script of neededScripts)
      check(available.has(script), "missing planned script witness or reference script");
  });
}

/**
 * Enforce this reference profile's Plutus V3 spend/mint witness surface: reject
 * native/older-version scripts, datum witnesses and bootstrap witnesses, then match
 * planned pointers and required programs. Input/reference evidence must already
 * have passed wallet authorization. Return observed redeemers without evaluating
 * scripts or validating the body's script-data hash. Borrow the witness set; each
 * nested scope releases only CML objects obtained within that scope.
 */
export function verifyWitnesses(
  witnesses: CML.TransactionWitnessSet,
  plan: TransactionPlan | null,
  inputRefs: string[],
  mintPolicies: string[],
  resolved: Map<string, ResolvedEffectInput>,
  references: Map<string, ResolvedEffectInput>,
  actualReferences: string[],
  networkId: number,
): VerifiedTransactionEffects["redeemers"] {
  return withCMLScope((own) => {
    const rejected = [
      witnesses.native_scripts(),
      witnesses.plutus_v1_scripts(),
      witnesses.plutus_v2_scripts(),
      witnesses.plutus_datums(),
      witnesses.bootstrap_witnesses(),
    ].filter((list) => list !== undefined);

    for (const list of rejected) {
      own(list);
      check(list.len() === 0, "unexpected script, datum or bootstrap witness");
    }

    // Establish expectations before reading actual pointers; the candidate cannot define its own intent.
    const { expected, neededScripts } = plannedWitnessRequirements(
      plan,
      inputRefs,
      mintPolicies,
      resolved,
      networkId,
    );
    const review = verifyRedeemers(witnesses, expected);

    verifyScriptAvailability(witnesses, neededScripts, references, actualReferences);

    return review;
  });
}
