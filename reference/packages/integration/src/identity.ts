/** Authenticates vault genesis against caller-pinned builds and network identity from accepted transaction history. */
import type { ChainPoint, Deployment, ProtectedInput } from "@ctvs/planning";
import { assertContext, assertSameValue, stateValue } from "@ctvs/planning";
import {
  type Config,
  configFromData,
  decodeData,
  encodeData,
  hex,
  NAMES,
  outRefData,
  refId,
  stateFromData,
} from "@ctvs/protocol";
import { applyParamsToScript, Data, validatorToScriptHash } from "@lucid-evolution/lucid";
import { protectedOutput } from "./ledger.js";
import type {
  AcceptedTransaction,
  LedgerOutput,
  NetworkBinding,
  ReviewedBuild,
  VaultRecord,
} from "./types.js";

/**
 * Locate the sole State-token output and verify the profile's empty genesis accounting.
 * Script custody, policy/Terms identity and exact value must agree with Config; a
 * matching datum without the State asset is not an initial State. Any mismatch throws
 * because the caller has already matched this output to a pinned genesis candidate.
 */
function initialState(
  tx: AcceptedTransaction,
  config: Config,
  policy: string,
  networkId: number,
): ProtectedInput {
  const candidates = tx.outputs.filter((o) => o.value[`${policy}.${NAMES.state}`] === 1n);

  if (candidates.length !== 1 || !candidates[0]) throw new Error("genesis requires unique State");

  const state = protectedOutput(candidates[0], policy, networkId);
  const datum = stateFromData(state.datum);

  if (
    datum.sequence !== 0n ||
    datum.backingAssets !== 0n ||
    datum.economicSupply !== 0n ||
    datum.accruedFees !== 0n ||
    datum.pauseFlags !== 0n ||
    datum.termsHash !== config.termsHash ||
    datum.vaultPolicy !== policy
  )
    throw new Error("invalid initial State");

  assertSameValue(state.value, stateValue(datum, config.terms));

  return state;
}

/**
 * Try one pinned build against a decoded Config by parameterizing its vault template.
 * A policy/ID mismatch returns null so other candidates may be considered. Once they
 * match, malformed Config custody, unconsumed seed, invalid State or family context
 * throws rather than being silently ignored. The accepted-chain assumption is still
 * required: these local checks do not independently execute genesis validators.
 */
function authenticateGenesis(
  tx: AcceptedTransaction,
  output: LedgerOutput,
  config: Config,
  build: ReviewedBuild,
  point: ChainPoint,
  network: NetworkBinding,
): VaultRecord | null {
  const policy = validatorToScriptHash({
    type: "PlutusV3",
    script: applyParamsToScript(build.vaultTemplate, [
      Data.from<Data>(hex(encodeData(outRefData(config.seed)))),
      config.termsHash,
    ]),
  });

  if (config.vaultPolicy !== policy || output.value[`${policy}.${NAMES.id}`] !== 1n) return null;

  const configLock = validatorToScriptHash(build.config);

  protectedOutput(output, configLock, network.networkId);
  assertSameValue(output.value, { ada: config.storageLovelace, [`${policy}.${NAMES.id}`]: 1n });

  if (!tx.inputs.some((ref) => refId(ref) === refId(config.seed)))
    throw new Error("genesis seed was not consumed");

  const state = initialState(tx, config, policy, network.networkId);
  const base = {
    network: network.name,
    networkDomain: network.domain,
    policy,
    configLock,
    termsHash: config.termsHash,
    configRef: output.ref,
    buildId: build.buildId,
    chainPoint: point,
  };
  const deployment: Deployment =
    build.family === "ctvs1"
      ? { ...base, family: "ctvs1", claimScript: null }
      : {
          ...base,
          family: "ctvs2",
          claimScript: validatorToScriptHash(
            build.claim ??
              (() => {
                throw new Error("missing reviewed Claim script");
              })(),
          ),
        };

  assertContext({ deployment, terms: config.terms }, build.family);

  return { deployment, terms: config.terms, genesis: { txId: tx.id, point }, state };
}

/**
 * Discover all genesis records in a phase-two-valid accepted transaction without
 * trusting a supplied policy or copied Config datum. Ignore outputs that cannot decode
 * as Config, belong to another network domain or match no pinned build. Matching
 * candidates must pass authentication and initial-State checks, and their records
 * retain the supplied chain point and transaction ID as genesis evidence.
 */
export function discoverGenesis(
  tx: AcceptedTransaction,
  point: ChainPoint,
  network: NetworkBinding,
  builds: readonly ReviewedBuild[],
): VaultRecord[] {
  if (!tx.valid) return [];

  const discovered: VaultRecord[] = [];

  for (const output of tx.outputs) {
    if (!output.datum) continue;

    let config: ReturnType<typeof configFromData>;

    // Candidate decoding is permissive about unrelated outputs; authentication failures below are not caught.
    try {
      config = configFromData(decodeData(output.datum));
    } catch {
      continue;
    }

    if (config.terms.networkDomain !== network.domain) continue;

    for (const build of builds) {
      const vault = authenticateGenesis(tx, output, config, build, point, network);

      if (!vault) continue;

      discovered.push(vault);
      break;
    }
  }

  return discovered;
}
