/** Explicit caller-side CBOR handoff. HTTP clients need not import the semantic decoder or any wallet code. */
import type {
  FamilyStateContext,
  ImplementationFamily,
  ProtectedInput,
  StateContext,
} from "@ctvs/planning";
import { resolveState } from "@ctvs/planning";
import { decodeData } from "@ctvs/protocol";
import { QueryError } from "./query/schema.js";
import type { ConstructionContext, RawInput } from "./query/types.js";

export function toPlannerInput(view: { source: RawInput; unspent: boolean }): ProtectedInput {
  if (!view.unspent)
    throw new QueryError(
      "STALE_BASIS",
      "source was already consumed at its observation point",
      409,
    );

  const { datumCbor, ...metadata } = structuredClone(view.source);

  return { ...metadata, datum: decodeData(datumCbor) };
}

export function toPlannerContext<F extends ImplementationFamily>(
  context: ConstructionContext,
  family: F,
): FamilyStateContext<F>;
export function toPlannerContext(context: ConstructionContext): StateContext;

export function toPlannerContext(
  context: ConstructionContext,
  family = context.deployment.family,
): StateContext {
  const result = {
    ...structuredClone(context),
    stateInput: toPlannerInput({ source: context.stateInput, unspent: true }),
  };

  resolveState(result, family);

  return result;
}
