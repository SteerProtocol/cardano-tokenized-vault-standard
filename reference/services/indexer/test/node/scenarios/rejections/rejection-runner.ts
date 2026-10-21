/** Counterfactual controls execute remotely; only expected node errors count as rejections. */

import { readAcceptedTransaction } from "@ctvs/integration";
import type { ReadQueries } from "@ctvs/integration/query";
import type { TransactionPlan } from "@ctvs/planning";
import { refId } from "@ctvs/protocol";
import { expect } from "vitest";
import { compiledFailure, evaluated } from "../../../support/evidence/rpc.js";
import { write } from "../../support/environment.js";
import type { Flow } from "../../support/flow.js";
import { nodeRpc } from "../../support/rpc.js";
import { controlBudgets } from "./rejection-budget.js";
import { negativeCandidate } from "./rejection-candidate.js";
import { rejectionAfter, rejectionBefore } from "./rejection-checks.js";

export interface RejectionVariant {
  label: string;
  mutate: (plan: TransactionPlan) => void;
  withdrawal?: string;
  phase1?: 3101;
  select?: () => void;
}

export async function rejectVariants(
  f: Flow,
  requested: ReadQueries,
  control: TransactionPlan,
  variants: RejectionVariant[],
  select: () => void = f.w.selectOwner,
) {
  select();

  const good = await negativeCandidate(f, `${variants[0]?.label}-control`, control);
  const controlEvaluation = await nodeRpc(f, "evaluateTransaction", good.signedCbor);

  write(f.env.directory, `${good.label}-node-evaluation`, controlEvaluation);

  controlBudgets(f, good.signedCbor, evaluated(controlEvaluation));

  const rejected = [];

  for (const variant of variants) {
    const plan = structuredClone(control);

    variant.mutate(plan);
    (variant.select ?? select)();

    const candidate = await negativeCandidate(f, variant.label, plan, variant.withdrawal);
    const before = await rejectionBefore(f, requested, candidate);
    const evaluation = await nodeRpc(f, "evaluateTransaction", candidate.signedCbor);

    if (variant.phase1) evaluated(evaluation);
    else {
      const errors = compiledFailure(evaluation);
      const target = plan.inputs[0];

      if (!target) throw new Error("missing expected rejected input");

      const transaction = readAcceptedTransaction(candidate.signedCbor);
      const index = transaction.inputs.findIndex((input) => refId(input) === refId(target.ref));

      expect(
        errors.some((row) => row.validator.purpose === "spend" && row.validator.index === index),
      ).toBe(true);
    }

    const submission = await nodeRpc(f, "submitTransaction", candidate.signedCbor);

    write(f.env.directory, `${variant.label}-rpc-attempt`, { evaluation, submission });

    expect(submission.error?.code).toBe(variant.phase1 ?? 3136);

    if (variant.phase1)
      expect(submission.error?.data).toEqual({ missingSignatories: [f.installed.terms.pauseKey] });

    const after = await rejectionAfter(f, requested, candidate, before);
    const result = {
      label: variant.label,
      txId: candidate.txId,
      controlTxId: good.txId,
      controlEvaluation,
      evaluation,
      submission,
      before: before.response,
      after,
      nodeRejected: true,
      constructionValidation: false,
    };

    write(f.env.directory, `${variant.label}-node-rejection`, result);
    rejected.push(result);
  }

  return { control: good, controlEvaluation, rejected };
}
