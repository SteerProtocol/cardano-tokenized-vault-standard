/** Construction checks consume an explicit published projection, network binding, State and chain point. */
import type { WalletAuthorization } from "@ctvs/cardano";
import { assertSameValue, type ChainPoint, type TransactionPlan } from "@ctvs/planning";
import { type OutRef, refId } from "@ctvs/protocol";
import { protectedMetadata } from "../ledger.js";
import { QueryError } from "../query/schema.js";
import type { RawInput } from "../query/types.js";
import type { LedgerOutput, NetworkBinding, Projection, VaultRecord } from "../types.js";

const samePoint = (a: ChainPoint, b: ChainPoint) =>
  a.slot === b.slot && a.blockHash === b.blockHash;

/**
 * Reject a plan from another deployment or reader snapshot before comparing effects.
 * Policy, Terms and reviewed build identities bind semantics; the exact chain point
 * prevents an older quote from becoming current merely because its CBOR still balances.
 * Network authorization must also agree with the caller-pinned reader connection.
 */
export function assertConstructionBinding(
  vault: VaultRecord,
  network: NetworkBinding,
  point: ChainPoint,
  plan: TransactionPlan,
  authorization: WalletAuthorization,
): void {
  const expected = vault.deployment,
    actual = plan.implementation;

  if (
    actual.policy.toLowerCase() !== expected.policy ||
    actual.family !== expected.family ||
    actual.buildId !== expected.buildId ||
    actual.termsHash.toLowerCase() !== expected.termsHash ||
    actual.configLock.toLowerCase() !== expected.configLock ||
    actual.claimScript?.toLowerCase() !== expected.claimScript?.toLowerCase() ||
    !samePoint(plan.chainPoint, point) ||
    authorization.networkName !== network.name ||
    authorization.networkDomain.toLowerCase() !== network.domain ||
    authorization.networkId !== network.networkId
  )
    throw new Error("construction is stale or bound to another vault/network/build");
}

/**
 * Corroborate planned protected inputs against unspent outputs in this projection.
 * Matching address/value and absent reference scripts prevent substituted evidence;
 * a State input must additionally be the current pricing State. Wallet funding and
 * other authorization sources remain the caller's responsibility, outside this check.
 */
export function assertCurrentPlanInputs(
  projection: Projection,
  vault: VaultRecord,
  plan: TransactionPlan,
  authorization: WalletAuthorization,
): void {
  for (const input of plan.inputs) {
    const source = projection.utxos.get(refId(input.ref));
    const resolved = authorization.planInputs.find((item) => refId(item.ref) === refId(input.ref));

    if (
      !source ||
      !resolved ||
      source.address !== resolved.address ||
      source.scriptRef ||
      resolved.referenceScript
    )
      throw new Error("protected input evidence does not match current indexed UTxO");

    assertSameValue(resolved.value, source.value);

    if (input.role === "state" && refId(input.ref) !== refId(vault.state.ref))
      throw new Error("pricing State is stale");
  }
}

export function rawSource(source: LedgerOutput, script: string, networkId: number): RawInput {
  if (!source.datum)
    throw new QueryError("INTERNAL_ERROR", "retained source lacks inline datum", 500);

  return {
    ...protectedMetadata(source, script, networkId),
    datumCbor: source.datum,
  };
}

export function recoveryData(
  projection: Projection,
  vault: VaultRecord,
  ref: OutRef,
  network: NetworkBinding,
  point: ChainPoint,
) {
  const request = projection.requests.get(refId(ref));

  if (
    vault.deployment.family !== "ctvs2" ||
    !request ||
    request.policy !== vault.deployment.policy ||
    request.status !== "pending_escrow" ||
    !request.source.datum
  )
    throw new QueryError("NOT_FOUND", "no unspent recognized recovery source", 404);

  return structuredClone({
    deployment: { ...vault.deployment, chainPoint: point },
    source: {
      ...protectedMetadata(request.source, vault.deployment.policy, network.networkId),
      datumCbor: request.source.datum,
    },
  });
}
