/** Adapts complete local transaction construction and signed evaluation to the generic selection policy. */
import {
  assertApprovedTransaction,
  ResourceLimitError,
  verifyTransactionEffects,
} from "@ctvs/cardano";
import type { TransactionPlan } from "@ctvs/planning";
import type { VaultFixture } from "../fixtures/vault.js";
import { constructPlan } from "./builder.js";
import { assertProtectedOutputs } from "./outputs.js";

/** Known errors from the pinned Lucid/CML/WASM stack only. Semantic failures stay fatal. */
export function constructionResourceFailure(error: unknown): ResourceLimitError | null {
  if (error instanceof ResourceLimitError) return error;

  const message = String(error);

  if (/Max transaction size of \d+ exceeded\. Found: \d+/.test(message))
    return new ResourceLimitError("size", message, { cause: error });

  if (
    /execution went over budget[\s\S]*Mem -\d+/.test(message) ||
    message.includes("Signed aggregate memory budget exceeds transaction limit")
  )
    return new ResourceLimitError("memory", message, { cause: error });

  if (
    /execution went over budget[\s\S]*CPU -\d+/.test(message) ||
    message.includes("Signed aggregate step budget exceeds transaction limit")
  )
    return new ResourceLimitError("steps", message, { cause: error });

  return null;
}

/**
 * The exact signed candidate whose size and budgets were checked, together with
 * its originating intent. Rebuilding it before submission would invalidate that
 * measurement; resource selection returns this object rather than a construction recipe.
 */
export interface PreparedSelectionPlan<P extends TransactionPlan> {
  plan: P;
  signedCbor: string;
  bytes: number;
}

/**
 * Real fixture adapter: construct with resolved UTxOs, check minimum-ADA balancing has
 * not changed protected payouts, sign using the ephemeral wallet, then evaluate the
 * signed bytes and declared budgets. The fixture authorizes funding and change before
 * construction and verifies all effects before signing. Never submits.
 */
export async function prepareSelectionCandidate<P extends TransactionPlan>(
  vault: VaultFixture,
  stage: string,
  plan: P,
): Promise<PreparedSelectionPlan<P>> {
  vault.recorder.evaluator.stage = stage;

  try {
    const authorization = await vault.authorize(plan);
    const builder = await constructPlan(vault.lucid, vault.emulator, vault.scripts, plan);
    const built = await builder.complete({ localUPLCEval: true });

    assertProtectedOutputs(built.toCBOR(), plan.outputs);

    const approval = verifyTransactionEffects(built.toCBOR(), plan, authorization);
    const signed = await built.sign.withWallet().complete();
    const signedCbor = signed.toCBOR();

    assertApprovedTransaction(signedCbor, approval);
    assertProtectedOutputs(signedCbor, plan.outputs);

    if (signedCbor.length / 2 > vault.recorder.parameters.maxTxSize)
      throw new ResourceLimitError("size", "Signed transaction exceeds protocol size ceiling");

    await vault.recorder.evaluator.verifySigned(signedCbor);

    return { plan, signedCbor, bytes: signedCbor.length / 2 };
  } catch (error) {
    throw constructionResourceFailure(error) ?? error;
  }
}
