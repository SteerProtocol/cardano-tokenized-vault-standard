/** Lowers protocol intents into Lucid builders; completion, wallet approval and evaluation happen later. */
import type { TransactionPlan } from "@ctvs/planning";
import { validatePlan } from "@ctvs/planning";
import type { OutRef } from "@ctvs/protocol";
import type { LucidEvolution, Provider, Script, TxBuilder, UTxO } from "@lucid-evolution/lucid";
import { datumHex, ledgerAddress, ledgerValue, only } from "./serialization.js";

/**
 * The vault executes through a published reference script; Claim delivery attaches
 * its separate program. The caller must supply bindings for the selected deployment.
 */
export interface ScriptBindings {
  vaultReference: UTxO;
  claim: Script | null;
}

/** Keep bigint POSIX intent exact at Lucid's number-valued time API boundary. */
function safeTime(value: bigint): number {
  const converted = Number(value);

  if (!Number.isSafeInteger(converted))
    throw new Error("Validity time exceeds safe slot-conversion range");

  return converted;
}

/**
 * Resolve the plan's required UTxOs and lower its effects into an unfinished builder.
 * Protected output order is already committed by redeemers and must be preserved.
 * Funding, min-ADA balancing, fees and collateral are chosen during completion;
 * the completed bytes therefore still require protected-output and wallet checks.
 * Provider trust and script provenance are supplied by the fixture, not proven here.
 */
export async function constructPlan(
  lucid: LucidEvolution,
  provider: Provider,
  bindings: ScriptBindings,
  plan: TransactionPlan,
): Promise<TxBuilder> {
  validatePlan(plan);

  const resolve = async (ref: OutRef): Promise<UTxO> =>
    only(
      await provider.getUtxosByOutRef([{ txHash: ref.txId, outputIndex: Number(ref.index) }]),
      `Missing authentic input ${ref.txId}#${ref.index}`,
    );

  let builder = lucid.newTx();
  const referenceInputs = await Promise.all(plan.referenceInputs.map(resolve));
  const needsVault =
    plan.mint.length > 0 ||
    plan.inputs.some((input) => input.role === "state" || input.role === "request");

  if (needsVault) referenceInputs.push(bindings.vaultReference);

  if (referenceInputs.length) builder = builder.readFrom(referenceInputs);

  for (const input of plan.inputs) {
    const resolved = await resolve(input.ref);

    builder =
      input.redeemer === null
        ? builder.collectFrom([resolved])
        : builder.collectFrom([resolved], datumHex(input.redeemer));
  }

  if (plan.inputs.some((input) => input.role === "claim")) {
    if (!bindings.claim) throw new Error("No claim program in this implementation");

    builder = builder.attach.SpendingValidator(bindings.claim);
  }

  for (const mint of plan.mint)
    builder = builder.mintAssets(
      Object.fromEntries(
        Object.entries(mint.assets).map(([name, quantity]) => [mint.policy + name, quantity]),
      ),
      datumHex(mint.redeemer),
    );

  // Adding or reordering a protected output would invalidate redeemer output indices.
  for (const output of plan.outputs) {
    const address = ledgerAddress(output.address),
      assets = ledgerValue(output.value);

    builder =
      output.datum === null
        ? builder.pay.ToAddress(address, assets)
        : builder.pay.ToAddressWithData(
            address,
            { kind: "inline", value: datumHex(output.datum) },
            assets,
          );
  }

  for (const signer of plan.requiredSigners) builder = builder.addSignerKey(signer);

  if (plan.validity)
    builder = builder
      .validFrom(safeTime(plan.validity.lowerPosixMs))
      .validTo(safeTime(plan.validity.upperPosixMs));

  return builder;
}
