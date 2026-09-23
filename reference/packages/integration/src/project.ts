/** Projects accepted vault transitions and Request/Claim lineage; an output at a vault establishes no entitlement by address alone. */
import type { ChainPoint } from "@ctvs/planning";
import { assertSameValue, claimValue, stateValue } from "@ctvs/planning";
import {
  claimFromData,
  decodeData,
  NAMES,
  redeemerFromData,
  refId,
  requestFromData,
  requestRecoveryFromCbor,
  type SettleEntry,
  stateFromData,
} from "@ctvs/protocol";
import { getAddressDetails } from "@lucid-evolution/lucid";
import { discoverGenesis } from "./identity.js";
import { protectedMetadata, protectedOutput, readAcceptedTransaction } from "./ledger.js";
import type {
  AcceptedTransaction,
  NetworkBinding,
  Projection,
  ReviewedBuild,
  VaultRecord,
} from "./types.js";

/**
 * Start a replay with fresh, independent collections. No inferred genesis, imported
 * balances or pre-intersection history is installed; authentication must arise from
 * subsequently supplied accepted transactions.
 */
export function emptyProjection(): Projection {
  return {
    vaults: new Map(),
    requests: new Map(),
    claims: new Map(),
    utxos: new Map(),
    transactions: new Set(),
  };
}

/**
 * Decode the spending action attached to an already tracked input, using the requested
 * role's wire envelope. Missing or malformed evidence throws: a known State, Request
 * or Claim cannot silently disappear from the projected lifecycle.
 */
function action(
  tx: AcceptedTransaction,
  ref: Parameters<typeof refId>[0],
  role: "state" | "request" | "claim",
) {
  const raw = tx.spends.get(refId(ref));

  if (!raw) throw new Error("authenticated spend has no redeemer");

  return redeemerFromData(role, decodeData(raw));
}

/**
 * Follow a consumed current State through its redeemer's designated output, checking
 * sequence, identity and exact custody value. For batches, authenticate every Claim
 * while vault.state still points to the consumed State, then publish the successor.
 * This projects an accepted action; its full arithmetic and authorization were not
 * independently re-executed by the reader.
 */
function advanceState(
  p: Projection,
  vault: VaultRecord,
  tx: AcceptedTransaction,
  point: ChainPoint,
  network: NetworkBinding,
) {
  const previous = vault.state;
  const before = stateFromData(previous.datum);
  const redeemer = action(tx, previous.ref, "state");

  if (redeemer.role !== "state") throw new Error("wrong State action");

  const successor = tx.outputs.find((o) => o.ref.index === redeemer.stateOutput);

  if (!successor) throw new Error("missing successor State");

  const state = protectedOutput(successor, vault.deployment.policy, network.networkId);
  const after = stateFromData(state.datum);

  if (
    after.sequence !== before.sequence + 1n ||
    after.vaultPolicy !== before.vaultPolicy ||
    after.termsHash !== before.termsHash
  )
    throw new Error("broken State continuity");

  assertSameValue(state.value, stateValue(after, vault.terms));

  if (redeemer.operation === "batch") {
    for (const entry of redeemer.entries) recordSettlement(p, vault, tx, entry, point, network);
  }

  vault.state = state;
  vault.deployment.chainPoint = point;
}

/**
 * Install one batch allocation only when it spends a known pending Request and creates
 * a correctly funded Claim tied to that Request and the consumed State. Update both
 * Request settlement history and the Claim index before generic input processing.
 * The prior State reference is essential: replacing it with the successor would sever
 * the on-chain lineage. Failure leaves a partial staging projection for the caller to discard.
 */
function recordSettlement(
  p: Projection,
  vault: VaultRecord,
  tx: AcceptedTransaction,
  entry: SettleEntry,
  point: ChainPoint,
  network: NetworkBinding,
): void {
  const previous = vault.state;
  const request = p.requests.get(refId(entry.requestRef));

  if (
    request?.status !== "pending_escrow" ||
    !tx.inputs.some((r) => refId(r) === refId(entry.requestRef))
  )
    throw new Error("missing settlement Request lineage");

  const source = tx.outputs.find((o) => o.ref.index === entry.claimOutput);
  const script = vault.deployment.claimScript;

  if (!source || !script) throw new Error("missing settlement Claim");

  const claim = claimFromData(protectedOutput(source, script, network.networkId).datum);

  if (
    claim.vaultPolicy !== vault.deployment.policy ||
    claim.termsHash !== vault.deployment.termsHash ||
    refId(claim.requestRef) !== refId(request.ref) ||
    refId(claim.stateRef) !== refId(previous.ref)
  )
    throw new Error("Claim lineage mismatch");

  assertSameValue(source.value, claimValue(claim));
  request.status = "claimable";
  request.settlement = { txId: tx.id, stateRef: previous.ref, claimRef: source.ref, point };
  p.claims.set(refId(source.ref), {
    ref: source.ref,
    claim,
    source,
    request: refId(request.ref),
    delivered: false,
  });
}

/**
 * Complete non-settlement Request spends as refunds and tracked Claim spends as delivery.
 * Run only after State batch processing has moved acknowledged Requests to claimable;
 * an acknowledge still attached to pending escrow indicates missing settlement lineage.
 * Output references come from the corresponding redeemer allocation, while the trusted
 * accepted feed supplies script validity. Retain records after marking their completion.
 */
function projectConsumedRequestsAndClaims(
  p: Projection,
  tx: AcceptedTransaction,
  point: ChainPoint,
): void {
  for (const ref of tx.inputs) {
    const request = p.requests.get(refId(ref));

    if (request?.status === "pending_escrow") {
      const r = action(tx, ref, "request");

      if (r.role !== "request" || r.operation === "acknowledge")
        throw new Error("Request consumed without settlement or recovery");

      const refund = tx.outputs.find((o) => o.ref.index === r.refundOutput);

      if (!refund) throw new Error("missing recovery output");

      request.status = "refunded";
      request.completion = { txId: tx.id, output: refund.ref, point };
    }

    const tracked = p.claims.get(refId(ref));

    if (tracked) {
      const r = action(tx, ref, "claim");

      if (r.role !== "claim") throw new Error("wrong Claim action");

      const entry = r.entries.find((e) => refId(e.claimRef) === refId(ref));
      const delivery = tx.outputs.find((o) => o.ref.index === entry?.receiverOutput);

      if (!delivery) throw new Error("missing delivery allocation");

      const origin = p.requests.get(tracked.request);

      if (!origin) throw new Error("missing Claim origin");

      origin.status = "delivered";
      origin.completion = { txId: tx.id, output: delivery.ref, point };
      tracked.delivered = true;
    }
  }
}

/**
 * Apply effective input/output changes, including collateral-only transactions, and
 * recognize Recovery envelopes at known CTVS-2 vaults. Keep all observed unspent outputs
 * for balances/candidate lookup, but never recognize State as Request escrow.
 * Envelope/custody failures leave ordinary UTxOs; economic decoding failures retain
 * a recognized Recovery source with null economics instead of losing the exit path.
 */
function projectUtxos(
  p: Projection,
  tx: AcceptedTransaction,
  point: ChainPoint,
  network: NetworkBinding,
): void {
  for (const ref of tx.inputs) p.utxos.delete(refId(ref));

  for (const source of tx.outputs) {
    p.utxos.set(refId(source.ref), source);

    if (!source.datum) continue;

    const details = getAddressDetails(source.address);
    const hash = details.paymentCredential?.type === "Script" ? details.paymentCredential.hash : "";
    const vault = p.vaults.get(hash);

    if (vault?.deployment.family !== "ctvs2" || source.value[`${hash}.${NAMES.state}`]) continue;

    // Arbitrary deposits at the vault are candidates, never automatically liabilities.
    try {
      protectedMetadata(source, hash, network.networkId);

      const { recovery } = requestRecoveryFromCbor(source.datum);

      if (recovery.vaultPolicy !== hash) continue;

      // Economic decoding must not become a prerequisite for cancel/expiry recovery.
      let request = null;

      try {
        request = requestFromData(decodeData(source.datum));
      } catch {
        /* Recovery remains available. */
      }

      p.requests.set(refId(source.ref), {
        ref: source.ref,
        policy: hash,
        recovery,
        request,
        source,
        created: point,
        status: "pending_escrow",
        settlement: null,
        completion: null,
      });
    } catch {
      /* Unrecognized outputs remain ordinary UTxOs. */
    }
  }
}

/**
 * Project one accepted transaction into caller-owned staging state. Deduplicate before
 * mutations, then process valid State transitions, Request/Claim consumption and genesis
 * in that order. Always apply effective UTxO changes, including invalid transactions'
 * collateral returns. Any exception requires discarding the staged block; this helper
 * does not provide its own rollback or verify the source's consensus acceptance.
 */
export function projectTransaction(
  p: Projection,
  cbor: string,
  point: ChainPoint,
  network: NetworkBinding,
  builds: readonly ReviewedBuild[],
): void {
  const tx = readAcceptedTransaction(cbor);

  if (p.transactions.has(tx.id)) throw new Error("duplicate accepted transaction");

  p.transactions.add(tx.id);

  if (tx.valid) {
    for (const vault of p.vaults.values()) {
      if (tx.inputs.some((r) => refId(r) === refId(vault.deployment.configRef)))
        throw new Error("immutable Config was consumed");

      if (tx.inputs.some((r) => refId(r) === refId(vault.state.ref)))
        advanceState(p, vault, tx, point, network);
    }

    // State settlement must establish Claim lineage before consumed Requests are classified.
    projectConsumedRequestsAndClaims(p, tx, point);

    for (const vault of discoverGenesis(tx, point, network, builds)) {
      if (p.vaults.has(vault.deployment.policy)) throw new Error("duplicate vault genesis");

      p.vaults.set(vault.deployment.policy, vault);
    }
  }

  // Invalid transactions already expose only collateral inputs and the collateral return.
  projectUtxos(p, tx, point, network);
}
