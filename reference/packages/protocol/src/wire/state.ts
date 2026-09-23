/** Config and State wire checks establish shape and commitments, not UTxO provenance. */
import { bytes, constr as C } from "../data/index.js";
import { integer, positive, quantity as q } from "../math/integer.js";
import type { Config, DataConstr, PlutusData, State } from "../types.js";
import {
  b28,
  b32,
  fields,
  MAGIC,
  outRefData,
  outRefFromData,
  readBytes,
  sized,
  version,
} from "./primitives.js";
import { termsData, termsFromData, termsHash } from "./terms.js";

/**
 * Encode Config with a positive lovelace reserve and an embedded Terms hash that matches its Terms.
 * The exact WIRE-2 envelope includes the seed, policy and Terms, within 4,608 preferred bytes.
 * The supplied policy is not derived from the seed here; applied-script identity and ID-token
 * custody must be authenticated from the actual genesis transaction.
 */
export function configData(config: Config): DataConstr {
  if (termsHash(config.terms) !== config.termsHash.toLowerCase())
    throw new Error("Config terms hash mismatch");

  return sized(
    C(3, [
      bytes(MAGIC),
      2n,
      b28(config.vaultPolicy),
      outRefData(config.seed),
      b32(config.termsHash),
      termsData(config.terms),
      positive(config.storageLovelace, "Config reserve"),
    ]),
    4608,
    "Config",
  );
}

/**
 * Decode exact Config role, arity and version, normalizing all byte identifiers.
 * Recheck embedded Terms commitment, reserve and preferred encoded size through configData.
 * A copied Config datum can pass these checks; this decoder alone does not establish vault identity.
 */
export function configFromData(data: PlutusData): Config {
  const f = fields(data, 3, 7, "Config");

  version(f[0], f[1]);

  const result: Config = {
    vaultPolicy: readBytes(f[2], 28),
    seed: outRefFromData(f[3]),
    termsHash: readBytes(f[4], 32),
    terms: termsFromData(f[5]),
    storageLovelace: positive(f[6]),
  };

  configData(result);

  return result;
}

/**
 * Encode WIRE-2 State with bounded nonnegative partitions, positive ADA reserve and pause bits 0..3.
 * Enforce the exact field order and a 256-byte preferred encoding limit.
 * Terms-dependent price/cap checks and the combined physical custody equation are separate;
 * a well-shaped State datum is not proof of a genuine State-token UTxO.
 */
export function stateData(state: State): DataConstr {
  return sized(
    C(0, [
      bytes(MAGIC),
      2n,
      b28(state.vaultPolicy),
      b32(state.termsHash),
      q(state.sequence),
      q(state.backingAssets),
      q(state.economicSupply),
      q(state.accruedFees),
      positive(state.storageLovelace, "State reserve"),
      integer(state.pauseFlags, "pause flags", 0n, 3n),
    ]),
    256,
    "State",
  );
}

/**
 * Decode exact State role, arity and version into bounded scalar fields and normalized identifiers.
 * Re-encoding checks the preferred-size ceiling, but no Terms or actual ledger value is supplied here.
 * Resolve through the planning context to check deployment/economics/custody, then authenticate
 * the referenced UTxO independently before using it as a live pricing snapshot.
 */
export function stateFromData(data: PlutusData): State {
  const f = fields(data, 0, 10, "State");

  version(f[0], f[1]);

  const result: State = {
    vaultPolicy: readBytes(f[2], 28),
    termsHash: readBytes(f[3], 32),
    sequence: q(f[4]),
    backingAssets: q(f[5]),
    economicSupply: q(f[6]),
    accruedFees: q(f[7]),
    storageLovelace: positive(f[8]),
    pauseFlags: integer(f[9], "pause flags", 0n, 3n),
  };

  stateData(result);

  return result;
}
