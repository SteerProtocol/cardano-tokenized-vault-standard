/** Builds role-specific WIRE-2 redeemers with distinct protected outputs and ordered entry lists. */
import { bytes, constr as C } from "../data/index.js";
import { integer, positive, quantity as q } from "../math/integer.js";
import type {
  BatchAction,
  DataConstr,
  DeliverEntry,
  DirectAction,
  MintAction,
  Operation,
  OutRef,
  PlutusData,
  Role,
} from "../types.js";
import {
  b28,
  destinationData,
  MAGIC,
  option,
  outputIndex,
  outRefData,
  sortedReferences,
} from "./primitives.js";

export const ROLE_TAGS = { state: 0, request: 1, claim: 2, mint: 3 } as const;
export const DIRECT_TAGS = { deposit: 0, mint: 1, withdraw: 2, redeem: 3 } as const;

/**
 * Wrap a role-specific action with the role constructor, protocol magic and WIRE-2 version.
 * Only the outer role is validated here; specialized action builders validate the payload.
 * The envelope prevents accidental cross-role decoding but cannot authorize a ledger script purpose.
 */
export function envelope(role: Role, action: PlutusData): DataConstr {
  if (!Object.hasOwn(ROLE_TAGS, role)) throw new Error("unsupported redeemer role");

  return C(ROLE_TAGS[role], [bytes(MAGIC), 2n, action]);
}

/**
 * Encode a direct operation with positive amount and user bound, retaining their operation-specific units.
 * Validate the receiver and distinct State/receiver output indices in 0..65,535.
 * The bytes express intent only; quoting, bound satisfaction and actual output effects are checked elsewhere.
 */
export function directRedeemer(
  operation: Operation,
  { receiver, amount, bound, stateOutput, receiverOutput }: DirectAction,
): DataConstr {
  if (!Object.hasOwn(DIRECT_TAGS, operation)) throw new Error("unsupported direct action");

  if (outputIndex(stateOutput) === outputIndex(receiverOutput))
    throw new Error("overlapping protected outputs");

  return envelope(
    "state",
    C(DIRECT_TAGS[operation], [
      destinationData(receiver),
      positive(amount),
      positive(bound),
      stateOutput,
      receiverOutput,
    ]),
  );
}

/**
 * Encode 1..16 unique Request allocations in canonical reference order without changing output indices.
 * State, Claim and optional reward output indices must all be distinct; Claim top-ups are lovelace.
 * A null reward index means no reward output. Fee totals, deadline/settler authorization and
 * complete transaction coverage require the settlement rules beyond this schema check.
 */
export function batchRedeemer({
  stateOutput,
  entries,
  rewardKey,
  rewardOutput,
}: BatchAction): DataConstr {
  outputIndex(stateOutput);
  b28(rewardKey);

  // Sorting changes entry order only; explicit output indices retain their intended associations.
  const sorted = sortedReferences(entries, (entry) => entry.requestRef),
    indices = [stateOutput, ...sorted.map((entry) => outputIndex(entry.claimOutput))];

  if (rewardOutput !== null) indices.push(outputIndex(rewardOutput));

  // One physical output cannot satisfy multiple protected State, Claim or reward obligations.
  if (new Set(indices).size !== indices.length) throw new Error("overlapping protected outputs");

  return envelope(
    "state",
    C(4, [
      stateOutput,
      sorted.map((entry) =>
        C(0, [outRefData(entry.requestRef), entry.claimOutput, q(entry.claimTopup)]),
      ),
      b28(rewardKey),
      option(rewardOutput, outputIndex),
    ]),
  );
}

export const acknowledgeRedeemer = (ref: OutRef): DataConstr =>
  envelope("request", C(0, [outRefData(ref)]));

export function refundRedeemer(mode: "cancel" | "expiry", index: bigint): DataConstr {
  if (mode !== "cancel" && mode !== "expiry") throw new Error("unsupported refund mode");

  return envelope("request", C(mode === "cancel" ? 1 : 2, [outputIndex(index)]));
}

/**
 * Encode either genesis output links or a supply update linked to an existing State reference.
 * Genesis Config/State output indices must be distinct; the update reference must be well formed.
 * No minted token names or quantities are derived here, so the minting validator still enforces supply.
 */
export function mintRedeemer(action: MintAction): DataConstr {
  if (action.genesis) {
    if (outputIndex(action.configOutput) === outputIndex(action.stateOutput))
      throw new Error("overlapping genesis outputs");

    return envelope("mint", C(0, [action.configOutput, action.stateOutput]));
  }

  return envelope("mint", C(1, [outRefData(action.stateRef)]));
}

/**
 * Encode a canonical list of 1..16 distinct Claim references with distinct receiver output indices.
 * Every consumed Claim is expected to carry this common complete list; the builder preserves
 * each supplied reference/output association. Only the transaction can prove the list is exhaustive.
 */
export function deliverRedeemer(entries: DeliverEntry[]): DataConstr {
  const sorted = sortedReferences(entries, (entry) => entry.claimRef),
    indices = sorted.map((entry) => outputIndex(entry.receiverOutput));

  if (new Set(indices).size !== indices.length) throw new Error("overlapping delivery outputs");

  return envelope(
    "claim",
    C(0, [sorted.map((entry) => C(0, [outRefData(entry.claimRef), entry.receiverOutput]))]),
  );
}

export function collectFeesRedeemer(stateOutput: bigint, feeOutput: bigint): DataConstr {
  if (outputIndex(stateOutput) === outputIndex(feeOutput))
    throw new Error("overlapping protected outputs");

  return envelope("state", C(5, [stateOutput, feeOutput]));
}

export const topUpRedeemer = (amount: bigint, stateOutput: bigint): DataConstr =>
  envelope("state", C(6, [positive(amount), outputIndex(stateOutput)]));

export const setPauseRedeemer = (flags: bigint, stateOutput: bigint): DataConstr =>
  envelope("state", C(7, [integer(flags, "pause flags", 0n, 3n), outputIndex(stateOutput)]));
