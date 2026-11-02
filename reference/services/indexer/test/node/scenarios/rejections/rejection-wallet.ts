/** A balanced extra wallet payment is rejected before any key signature or submission. */
import { verifyTransactionEffects } from "@ctvs/cardano";
import type { ReadQueries } from "@ctvs/integration/query";
import type { TransactionPlan } from "@ctvs/planning";
import { expect } from "vitest";
import { constructPlan } from "../../../../../../testing/ledger/builder.js";
import { write } from "../../support/environment.js";
import type { Flow } from "../../support/flow.js";
import { claimProgram } from "../../support/install.js";
import { authorize } from "../../support/wallet.js";
import { rejectionAfter, rejectionBefore } from "./rejection-checks.js";

export async function rejectWalletPayment(
  f: Flow,
  requested: ReadQueries,
  plan: TransactionPlan,
  address: string,
) {
  f.w.selectOwner();

  const builder = await constructPlan(
    f.w.lucid,
    f.w.provider,
    {
      vaultReference: f.installed.reference,
      claim: f.installed.deployment.family === "ctvs2" ? claimProgram(f.env) : null,
    },
    plan,
  );
  const built = await builder.pay
    .ToAddress(address, { lovelace: 50000000n })
    .complete({ localUPLCEval: false });
  const candidate = {
    label: "unapproved-wallet-payment",
    txId: built.toHash(),
    signedCbor: built.toCBOR(),
    plan,
    constructionValidation: false,
  };
  const before = await rejectionBefore(f, requested, candidate);
  const authorization = await authorize(
    f.w.lucid,
    f.w.provider,
    f.installed.deployment,
    plan,
    f.installed.reference,
  );

  expect(() => verifyTransactionEffects(built.toCBOR(), plan, authorization)).toThrow(
    /unapproved output/,
  );
  await rejectionAfter(f, requested, candidate, before);
  write(f.env.directory, "unapproved-wallet-payment-effects-rejection", {
    layer: "wallet_effects",
    txId: candidate.txId,
    unsignedCbor: candidate.signedCbor,
    approvalRejected: true,
    signed: false,
    nodeSubmissionAttempted: false,
  });
}
