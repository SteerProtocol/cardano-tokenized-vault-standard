/** Decodes role-selected actions and reuses encoder constraints to reject contradictory wire intent. */
import { constructorIndex, equalData, isConstr } from "../data/index.js";
import { integer, positive, quantity as q } from "../math/integer.js";
import type {
  ClaimRedeemer,
  DecodedRedeemer,
  MintRedeemer,
  Operation,
  PlutusData,
  RequestRedeemer,
  Role,
  StateRedeemer,
} from "../types.js";
import {
  acknowledgeRedeemer,
  batchRedeemer,
  collectFeesRedeemer,
  deliverRedeemer,
  directRedeemer,
  mintRedeemer,
  ROLE_TAGS,
  refundRedeemer,
  setPauseRedeemer,
  topUpRedeemer,
} from "./actions.js";
import {
  destinationFromData,
  fields,
  outputIndex,
  outRefFromData,
  readBytes,
  readOption,
  version,
} from "./primitives.js";

type Decoded<T extends DecodedRedeemer> = { result: T; rebuilt: PlutusData };

/**
 * Decode one exact State action variant and rebuild its full role envelope.
 * Rebuilding shares encoder constraints such as disjoint output allocations and bounded quantities;
 * the public decoder then compares semantic Data to detect unsorted action lists.
 */
function stateAction(action: PlutusData): Decoded<StateRedeemer> {
  if (!isConstr(action)) throw new Error("unsupported state action");

  const operations: readonly Operation[] = ["deposit", "mint", "withdraw", "redeem"];
  const index = constructorIndex(action.constr);
  const operation = index < 4n ? operations[Number(index)] : undefined;

  if (operation !== undefined) {
    const f = fields(action, action.constr, 5, "direct action");
    const result: StateRedeemer = {
      role: "state",
      operation,
      receiver: destinationFromData(f[0]),
      amount: positive(f[1]),
      bound: positive(f[2]),
      stateOutput: outputIndex(f[3]),
      receiverOutput: outputIndex(f[4]),
    };

    return { result, rebuilt: directRedeemer(operation, result) };
  }

  if (constructorIndex(action.constr) === 4n) {
    const f = fields(action, 4, 4, "Batch");

    if (!Array.isArray(f[1])) throw new Error("Batch entries must be a list");

    const entries = f[1].map((entry) => {
      const [ref, claimOutput, claimTopup] = fields(entry, 0, 3, "SettleEntry");

      return {
        requestRef: outRefFromData(ref),
        claimOutput: outputIndex(claimOutput),
        claimTopup: q(claimTopup),
      };
    });
    const result: StateRedeemer = {
      role: "state",
      operation: "batch",
      stateOutput: outputIndex(f[0]),
      entries,
      rewardKey: readBytes(f[2], 28),
      rewardOutput: readOption(f[3], outputIndex),
    };

    return { result, rebuilt: batchRedeemer(result) };
  }

  if (constructorIndex(action.constr) === 5n) {
    const [stateOutput, feeOutput] = fields(action, 5, 2, "CollectFees");
    const result: StateRedeemer = {
      role: "state",
      operation: "collect_fees",
      stateOutput: outputIndex(stateOutput),
      feeOutput: outputIndex(feeOutput),
    };

    return { result, rebuilt: collectFeesRedeemer(result.stateOutput, result.feeOutput) };
  }

  if (constructorIndex(action.constr) === 6n) {
    const [amount, stateOutput] = fields(action, 6, 2, "TopUpReserve");
    const result: StateRedeemer = {
      role: "state",
      operation: "top_up_reserve",
      amount: positive(amount),
      stateOutput: outputIndex(stateOutput),
    };

    return { result, rebuilt: topUpRedeemer(result.amount, result.stateOutput) };
  }

  if (constructorIndex(action.constr) === 7n) {
    const [flags, stateOutput] = fields(action, 7, 2, "SetPause");
    const result: StateRedeemer = {
      role: "state",
      operation: "set_pause",
      flags: integer(flags, "pause flags", 0n, 3n),
      stateOutput: outputIndex(stateOutput),
    };

    return { result, rebuilt: setPauseRedeemer(result.flags, result.stateOutput) };
  }

  throw new Error("unsupported state action");
}

/**
 * Separate settlement acknowledgment from cancellation/expiry recovery by exact action tag.
 * Acknowledgment carries a State reference; recovery carries a refund output index.
 * Rebuild the matching role envelope, leaving actual State linkage, controller authority
 * and deadline satisfaction to the consuming transaction rules.
 */
function requestAction(action: PlutusData): Decoded<RequestRedeemer> {
  if (!isConstr(action)) throw new Error("unsupported request action");

  if (constructorIndex(action.constr) === 0n) {
    const stateRef = outRefFromData(fields(action, 0, 1, "Acknowledgment")[0]);

    return {
      result: { role: "request", operation: "acknowledge", stateRef },
      rebuilt: acknowledgeRedeemer(stateRef),
    };
  }

  if (constructorIndex(action.constr) === 1n || constructorIndex(action.constr) === 2n) {
    const refundOutput = outputIndex(fields(action, action.constr, 1, "Refund")[0]),
      operation = constructorIndex(action.constr) === 1n ? "cancel" : "expiry";

    return {
      result: { role: "request", operation, refundOutput },
      rebuilt: refundRedeemer(operation, refundOutput),
    };
  }

  throw new Error("unsupported request action");
}

/**
 * Decode the Claim-delivery allocation list and rebuild it with the shared encoder.
 * Rebuilding rejects duplicate references/outputs and invalid cardinality; comparison in the
 * public decoder also rejects a list that was supplied out of canonical order.
 */
function claimAction(action: PlutusData): Decoded<ClaimRedeemer> {
  const [list] = fields(action, 0, 1, "Delivery");

  if (!Array.isArray(list)) throw new Error("Delivery entries must be a list");

  const entries = list.map((entry) => {
    const [ref, receiverOutput] = fields(entry, 0, 2, "DeliverEntry");

    return { claimRef: outRefFromData(ref), receiverOutput: outputIndex(receiverOutput) };
  });

  return {
    result: { role: "claim", operation: "deliver", entries },
    rebuilt: deliverRedeemer(entries),
  };
}

/**
 * Decode genesis allocation links or a later supply-update State reference, never both.
 * Rebuild through mintRedeemer so genesis output separation is checked in one place.
 * Token quantities and one-shot seed consumption are absent from this action schema and
 * must be established from the transaction by the minting policy.
 */
function mintAction(action: PlutusData): Decoded<MintRedeemer> {
  if (!isConstr(action)) throw new Error("unsupported mint action");

  if (constructorIndex(action.constr) === 0n) {
    const [configOutput, stateOutput] = fields(action, 0, 2, "Initialization");
    const result: MintRedeemer = {
      role: "mint",
      operation: "initialize",
      genesis: true,
      configOutput: outputIndex(configOutput),
      stateOutput: outputIndex(stateOutput),
    };

    return { result, rebuilt: mintRedeemer(result) };
  }

  if (constructorIndex(action.constr) === 1n) {
    const stateRef = outRefFromData(fields(action, 1, 1, "SupplyUpdate")[0]);
    const result: MintRedeemer = {
      role: "mint",
      operation: "supply_update",
      genesis: false,
      stateRef,
    };

    return { result, rebuilt: mintRedeemer(result) };
  }

  throw new Error("unsupported mint action");
}

/**
 * Decode only the caller-selected role with exact envelope/version and recursive action arities.
 * Rebuild and compare semantic Data so reordered lists cannot be silently accepted as canonical.
 * This normalizes byte fields but does not compare original CBOR spellings or prove that the
 * transaction actually satisfies the requested operation, output links or authorization.
 */
export function redeemerFromData(role: "state", data: PlutusData): StateRedeemer;
export function redeemerFromData(role: "request", data: PlutusData): RequestRedeemer;
export function redeemerFromData(role: "claim", data: PlutusData): ClaimRedeemer;
export function redeemerFromData(role: "mint", data: PlutusData): MintRedeemer;
export function redeemerFromData(role: Role, data: PlutusData): DecodedRedeemer;

export function redeemerFromData(role: Role, data: PlutusData): DecodedRedeemer {
  if (!Object.hasOwn(ROLE_TAGS, role)) throw new Error("unsupported redeemer role");

  const [magic, wireVersion, action] = fields(data, ROLE_TAGS[role], 3, `${role} envelope`);

  version(magic, wireVersion);

  const { result, rebuilt } =
    role === "state"
      ? stateAction(action)
      : role === "request"
        ? requestAction(action)
        : role === "claim"
          ? claimAction(action)
          : mintAction(action);

  // Rebuilding reapplies encoder constraints and detects entries that arrived in a different order.
  if (!equalData(rebuilt, data)) throw new Error("noncanonical semantic action order");

  return result;
}
