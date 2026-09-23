/** CTVS-1 plans couple a State transition to immediate share or underlying-asset delivery. */
import type { FamilyStateContext, TransactionPlan } from "@ctvs/planning";
import {
  createPlan,
  input,
  output,
  ownAsset,
  resolveState,
  scriptDestination,
  stateValue,
  value,
} from "@ctvs/planning";
import type { Destination, Operation, Quote } from "@ctvs/protocol";
import {
  directRedeemer,
  mintRedeemer,
  NAMES,
  quantity,
  stateData,
  transition,
} from "@ctvs/protocol";

export interface DirectOptions extends FamilyStateContext<"ctvs1"> {
  operation: Operation;
  /** Operation input: gross assets for deposit, shares for mint/redeem, net assets for withdraw. */
  amount: bigint;
  /** Minimum receipt for deposit/redeem or maximum required input for mint/withdraw. */
  bound: bigint;
  receiver: Destination;
  /** External lovelace for receiver output funding; not included in quoted assets or shares. */
  receiverTopup?: bigint;
}
export interface DirectPlan extends TransactionPlan {
  operation: Operation;
  approvedBound: bigint;
  economicEffects: Quote;
  /** Receiver ADA amount still to be supplied by wallet funding during transaction construction. */
  externalTopups: bigint;
}

/**
 * Resolve a consistent CTVS-1 State and produce one immediate economic transition.
 * Amount/bound units follow the selected operation; return the checked quote, signed share delta
 * and fixed State/receiver outputs without mutating the supplied snapshot.
 * receiverTopup is externally funded lovelace. Funding, minimum ADA, collateral, signatures
 * and final transaction evaluation remain outside this unsigned plan.
 */
export function buildDirectPlan(options: DirectOptions): DirectPlan {
  const state = resolveState(options, "ctvs1");
  const { deployment, terms, stateInput, operation, amount, bound, receiver } = options;
  // Output ADA is externally funded, including when the quoted underlying asset is itself ADA.
  const receiverTopup = quantity(options.receiverTopup ?? 0n, "receiver topup");
  const result = transition(operation, amount, bound, state, terms),
    entry = operation === "deposit" || operation === "mint";
  const asset = entry ? ownAsset(deployment.policy, "share") : terms.underlying;
  const economic = entry ? result.quote.shares : result.quote.netAssets;
  // Redeemer indices bind State to output 0 and the receiver to output 1.
  const plan = createPlan({
    operation,
    deployment,
    inputs: [
      input(
        stateInput.ref,
        "state",
        directRedeemer(operation, { receiver, amount, bound, stateOutput: 0n, receiverOutput: 1n }),
      ),
    ],
    referenceInputs: [deployment.configRef],
    outputs: [
      output(
        "state",
        scriptDestination(deployment.policy),
        stateValue(result.successor, terms),
        stateData(result.successor),
      ),
      output(
        "receiver",
        receiver,
        value([
          [asset, economic],
          ["ada", receiverTopup],
        ]),
      ),
    ],
    mint: [
      {
        policy: deployment.policy,
        assets: { [NAMES.share]: result.shareMint },
        redeemer: mintRedeemer({ genesis: false, stateRef: stateInput.ref }),
      },
    ],
  });

  return {
    ...plan,
    operation,
    approvedBound: bound,
    economicEffects: result.quote,
    externalTopups: receiverTopup,
  };
}
