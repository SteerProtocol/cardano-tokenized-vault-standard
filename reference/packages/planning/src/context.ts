/** Checks consistency of caller-supplied deployment and UTxO evidence without authenticating the chain. */
import type { Destination, State } from "@ctvs/protocol";
import {
  addressData,
  credentialData,
  enterprise,
  equalData,
  equalHex,
  outRefData,
  quantity,
  stateFromData,
  termsData,
  termsHash,
  validateEconomics,
} from "@ctvs/protocol";
import type {
  Context,
  Deployment,
  FiniteValidity,
  ImplementationFamily,
  ProtectedInput,
  StateContext,
  TimeBounds,
} from "./types.js";
import { actualValue, assertSameValue, stateValue } from "./value.js";

// Compiled families support their own immediate or request paths, not mixed-path vaults.
const MODES: Record<ImplementationFamily, readonly bigint[]> = {
  ctvs1: [1n, 2n, 3n],
  ctvs2: [4n, 8n, 12n],
};

/**
 * Narrow a supplied deployment to the selected client family and its Claim-script requirement.
 * CTVS-1 requires no Claim script; CTVS-2 requires one.
 * This checks declared configuration only. Script hash syntax and deployment provenance are separate.
 */
export function assertDeploymentFamily<F extends ImplementationFamily>(
  deployment: Deployment,
  expected: F,
): asserts deployment is Extract<Deployment, { family: F }> {
  if (deployment.family !== expected)
    throw new Error(`expected ${expected} deployment, received ${deployment.family}`);

  if (expected === "ctvs1" && deployment.claimScript !== null)
    throw new Error("ctvs1 deployment cannot depend on a claim script");

  if (expected === "ctvs2" && deployment.claimScript === null)
    throw new Error("ctvs2 deployment requires a claim script");
}

/**
 * Validate Terms and their commitment against the supplied family, script identifiers and network domain.
 * Reject the family's unsupported mode combinations and an underlying asset under the vault policy.
 * Check build/chain-point metadata shape without fetching chain state or deriving the applied script.
 * A successful check means internal consistency, not authenticated deployment or supported vault lifecycle.
 */
export function assertContext(context: Context, family: ImplementationFamily): void {
  const { deployment, terms } = context;

  assertDeploymentFamily(deployment, family);
  termsData(terms);

  if (!MODES[family].includes(terms.executionModes))
    throw new Error(`${family} terms advertise incompatible execution modes`);

  for (const hash of [deployment.policy, deployment.configLock])
    credentialData({ type: "script", hash });

  if (deployment.claimScript !== null)
    credentialData({ type: "script", hash: deployment.claimScript });

  if (!deployment.network || !equalHex(deployment.networkDomain, terms.networkDomain))
    throw new Error("explicit matching network identity required");

  if (!equalHex(deployment.termsHash, termsHash(terms)))
    throw new Error("deployment terms commitment mismatch");

  if (terms.underlying !== "ada" && equalHex(terms.underlying.policy, deployment.policy))
    throw new Error("underlying under vault policy is forbidden");

  if (!deployment.buildId) throw new Error("implementation build binding required");

  quantity(deployment.chainPoint.slot, "chain slot");
  outRefData({ txId: deployment.chainPoint.blockHash, index: 0n });
}

/**
 * Require a valid reference, exact enterprise script address, inline datum mode and no reference script.
 * Validate all supplied custody asset identifiers and nonnegative bounded quantities.
 * The datum is intentionally excluded so raw recovery can share these metadata checks.
 * This cannot establish that the UTxO exists, is unspent or contains the asserted datum/value.
 */
export function assertProtectedInput(input: Omit<ProtectedInput, "datum">, script: string): void {
  outRefData(input.ref);

  if (!equalData(addressData(input.address), addressData(enterprise(script))))
    throw new Error("wrong protected input address");

  if (input.referenceScript !== null)
    throw new Error("protected input must explicitly have no reference script");

  if (input.datumMode !== "inline") throw new Error("protected input must use inline datum");

  actualValue(input.value);
}

/**
 * Decode the supplied inline State after checking the deployment, Terms and protected-input metadata.
 * Require State policy/Terms bindings, numeric economics and the complete closed custody equation,
 * including exactly one State token and no surplus assets. Returns decoded State without chain I/O.
 * The caller must independently authenticate this UTxO and refresh it when its chain point changes.
 */
export function resolveState(context: StateContext, family: ImplementationFamily): State {
  assertContext(context, family);

  const { deployment, stateInput, terms } = context;

  assertProtectedInput(stateInput, deployment.policy);

  const state = stateFromData(stateInput.datum);

  if (
    !equalHex(state.vaultPolicy, deployment.policy) ||
    !equalHex(state.termsHash, deployment.termsHash)
  )
    throw new Error("state deployment binding mismatch");

  validateEconomics(state, terms);
  assertSameValue(stateInput.value, stateValue(state, terms));
  outRefData(deployment.configRef);

  return state;
}

/**
 * Return a fresh interval with inclusive lower and exclusive upper POSIX-millisecond bounds.
 * Both endpoints must be bounded nonnegative bigint values with lower strictly below upper.
 * No wall-clock check or slot conversion occurs here; construction must preserve this interval
 * when mapping to the selected network's slot configuration.
 */
export function finiteValidity(bounds: TimeBounds): FiniteValidity {
  quantity(bounds.lowerPosixMs, "validity lower bound");
  quantity(bounds.upperPosixMs, "validity upper bound");

  if (bounds.lowerPosixMs >= bounds.upperPosixMs)
    throw new Error("validity interval must be finite and nonempty");

  return { ...bounds, lowerInclusive: true, upperExclusive: true };
}

export function scriptDestination(hash: string): Destination {
  return { address: enterprise(hash), datum: null };
}
