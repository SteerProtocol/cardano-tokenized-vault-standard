/** Builds the shared initialization intent while retaining each implementation family's script bindings. */
import type { State } from "@ctvs/protocol";
import {
  configData,
  mintRedeemer,
  NAMES,
  outRefData,
  positive,
  stateData,
  validateEconomics,
} from "@ctvs/protocol";
import { assertContext, scriptDestination } from "./context.js";
import { createPlan, input, output } from "./plan.js";
import type { GenesisOptions, ImplementationFamily, TransactionPlan } from "./types.js";
import { ownAsset, stateValue, value } from "./value.js";

/**
 * Build an unsigned family-bound initialization intent from a supplied seed and positive ADA reserves.
 * Consume the seed, place Config/State at outputs 0/1, and mint one ID plus one STATE token.
 * Initial backing, economic supply and fees are zero; SHARE is not minted at genesis.
 * The caller must verify the applied script's seed binding and ledger provenance, fund minimum ADA,
 * and replace provisional Config-reference metadata with the actual transaction output reference.
 */
export function createGenesisPlan(
  family: ImplementationFamily,
  options: GenesisOptions,
): TransactionPlan {
  assertContext(options, family);

  const { deployment, terms, seed, configReserve, stateReserve } = options;

  outRefData(seed);
  positive(configReserve);
  positive(stateReserve);

  const state: State = {
    vaultPolicy: deployment.policy,
    termsHash: deployment.termsHash,
    sequence: 0n,
    backingAssets: 0n,
    economicSupply: 0n,
    accruedFees: 0n,
    storageLovelace: stateReserve,
    pauseFlags: 0n,
  };

  validateEconomics(state, terms);

  const config = {
    vaultPolicy: deployment.policy,
    termsHash: deployment.termsHash,
    seed,
    terms,
    storageLovelace: configReserve,
  };

  return createPlan({
    operation: "genesis",
    deployment,
    inputs: [input(seed, "genesis_seed")],
    referenceInputs: [],
    outputs: [
      output(
        "config",
        scriptDestination(deployment.configLock),
        value([
          ["ada", configReserve],
          [ownAsset(deployment.policy, "id"), 1n],
        ]),
        configData(config),
      ),
      output(
        "state",
        scriptDestination(deployment.policy),
        stateValue(state, terms),
        stateData(state),
      ),
    ],
    mint: [
      {
        policy: deployment.policy,
        assets: { [NAMES.id]: 1n, [NAMES.state]: 1n },
        redeemer: mintRedeemer({ genesis: true, configOutput: 0n, stateOutput: 1n }),
      },
    ],
  });
}
