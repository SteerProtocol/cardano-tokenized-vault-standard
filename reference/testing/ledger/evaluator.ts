/** Records phase-two evaluation evidence for construction and final signed CBOR in the local harness. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  CML,
  type CMLOwn,
  type EvalRedeemer,
  type EvaluationInput,
  type EvaluatorAdapter,
  fromCMLRedeemerTag,
  utxoToTransactionInput,
  utxoToTransactionOutput,
  withCMLScope,
} from "@lucid-evolution/lucid";
import { eval_phase_two_raw } from "@lucid-evolution/uplc";

/** Hash the complete captured bytes for evidence correlation; this is not the ledger transaction ID. */
export function cborHash(hex: string): string {
  return createHash("sha256").update(Buffer.from(hex, "hex")).digest("hex");
}

/**
 * Evidence from one attempt, including failures. Construction and signed records
 * share a scenario stage but can have different bytes and execution costs.
 * accepted reports this evaluator's checks, not acceptance by a cardano-node.
 */
export interface EvaluationRecord {
  stage: string;
  phase: "construction" | "signed";
  cborSha256: string;
  accepted: boolean;
  redeemers?: EvalRedeemer[];
  error?: string;
}

interface Budget {
  memory: bigint;
  steps: bigint;
}

/**
 * Read signed witness budgets by purpose/index, normalizing legacy and map redeemers.
 * The owning scope outlives this traversal; the returned map contains plain bigint
 * values. Duplicate pointers fail rather than overwriting an earlier declaration.
 */
function declaredBudgets(transaction: CML.Transaction, own: CMLOwn): Map<string, Budget> {
  const result = new Map<string, Budget>();
  const witnesses = own(transaction.witness_set());
  const optional = witnesses.redeemers();

  if (!optional) return result;

  const redeemers = own(optional);
  const flat = own(redeemers.to_flat_format());

  for (let index = 0; index < flat.len(); index++) {
    const redeemer = own(flat.get(index));
    const units = own(redeemer.ex_units());
    const key = `${fromCMLRedeemerTag(redeemer.tag())}:${redeemer.index()}`;

    assert.ok(!result.has(key), `Duplicate signed redeemer ${key}`);
    result.set(key, { memory: units.mem(), steps: units.steps() });
  }

  return result;
}

function purpose(redeemer: EvalRedeemer): string {
  return `${redeemer.redeemer_tag}:${redeemer.redeemer_index}`;
}

/**
 * Supply actual Plutus execution alongside the Emulator's local ledger checks.
 * Construction captures resolved inputs, cost models and the exact set of executed
 * purposes. Signed verification reuses that context and compares witness budgets.
 * Mutable stage/phase state belongs to one sequential fixture, not concurrent builds.
 */
export class RecordedEvaluator implements EvaluatorAdapter {
  readonly name = "ctvs-pinned-aiken-wasm";
  readonly records: EvaluationRecord[] = [];
  readonly inputs = new Map<string, EvaluationInput>();
  private readonly constructionPurposes = new Map<string, Set<string>>();
  stage = "setup";
  phase: EvaluationRecord["phase"] = "construction";

  /**
   * Evaluate every script against the supplied resolved inputs and network parameters.
   * Construction records the purpose set only on success. In signed phase, both
   * declared and evaluated purposes must match that set, each declared budget must
   * cover measured cost, and aggregate measured/declared budgets must fit the limits.
   * Failed attempts still append evidence and propagate the original error.
   */
  async evaluate(input: EvaluationInput): Promise<EvalRedeemer[]> {
    this.inputs.set(this.stage, input);

    // A failed new construction attempt must not inherit successful purpose coverage from an older one.
    if (this.phase === "construction") this.constructionPurposes.delete(this.stage);

    const record: EvaluationRecord = {
      stage: this.stage,
      phase: this.phase,
      cborSha256: cborHash(input.tx),
      accepted: false,
    };

    try {
      return withCMLScope((own) => {
        const { context, additionalUTxOs } = input;
        const transaction = own(CML.Transaction.from_cbor_hex(input.tx));
        const encoded = eval_phase_two_raw(
          transaction.to_cbor_bytes(),
          additionalUTxOs.map((utxo) => own(utxoToTransactionInput(utxo)).to_cbor_bytes()),
          additionalUTxOs.map((utxo) => own(utxoToTransactionOutput(utxo)).to_cbor_bytes()),
          context.costModels.to_cbor_bytes(),
          context.protocolParameters.maxTxExSteps,
          context.protocolParameters.maxTxExMem,
          BigInt(context.slotConfig.zeroTime),
          BigInt(context.slotConfig.zeroSlot),
          context.slotConfig.slotLength,
        );
        const redeemers = encoded.map((bytes): EvalRedeemer => {
          const redeemer = own(CML.LegacyRedeemer.from_cbor_bytes(bytes));
          const units = own(redeemer.ex_units());

          return {
            redeemer_tag: fromCMLRedeemerTag(redeemer.tag()),
            redeemer_index: Number(redeemer.index()),
            ex_units: { mem: Number(units.mem()), steps: Number(units.steps()) },
          };
        });

        assert.ok(
          redeemers.reduce((total, r) => total + BigInt(r.ex_units.mem), 0n) <=
            context.protocolParameters.maxTxExMem,
        );
        assert.ok(
          redeemers.reduce((total, r) => total + BigInt(r.ex_units.steps), 0n) <=
            context.protocolParameters.maxTxExSteps,
        );

        const evaluatedPurposes = new Set(redeemers.map(purpose));

        assert.equal(evaluatedPurposes.size, redeemers.length, "Duplicate evaluated redeemer");

        // Global limits alone are insufficient: every declared purpose must also cover its actual cost.
        if (this.phase === "signed") {
          const declared = declaredBudgets(transaction, own);
          const expected = this.constructionPurposes.get(this.stage);

          assert.ok(expected, "Missing successful construction evaluation for signed transaction");
          assert.deepEqual(
            new Set(declared.keys()),
            expected,
            "Signed redeemer coverage changed after construction",
          );
          assert.deepEqual(
            evaluatedPurposes,
            expected,
            "Signed evaluation did not cover every redeemer",
          );
          assert.ok(
            [...declared.values()].reduce((sum, budget) => sum + budget.memory, 0n) <=
              context.protocolParameters.maxTxExMem,
            "Signed aggregate memory budget exceeds transaction limit",
          );
          assert.ok(
            [...declared.values()].reduce((sum, budget) => sum + budget.steps, 0n) <=
              context.protocolParameters.maxTxExSteps,
            "Signed aggregate step budget exceeds transaction limit",
          );

          for (const redeemer of redeemers) {
            const key = purpose(redeemer),
              budget = declared.get(key);

            assert.ok(budget, `Missing signed budget for ${key}`);
            assert.ok(
              budget.memory >= BigInt(redeemer.ex_units.mem),
              `Insufficient signed memory budget for ${key}`,
            );
            assert.ok(
              budget.steps >= BigInt(redeemer.ex_units.steps),
              `Insufficient signed step budget for ${key}`,
            );
          }
        } else {
          this.constructionPurposes.set(this.stage, evaluatedPurposes);
        }

        record.accepted = true;
        record.redeemers = redeemers;

        return redeemers;
      });
    } catch (error) {
      record.error = String(error);

      throw error;
    } finally {
      this.records.push(record);
    }
  }

  /**
   * Re-evaluate final CBOR using the successful construction context for this stage.
   * Key-only transactions need no captured Plutus context, but a transaction carrying
   * any redeemer must have one. Phase state is restored even on failure so a later
   * construction cannot accidentally inherit signed-verification behavior.
   */
  async verifySigned(tx: string): Promise<void> {
    const inputs = this.inputs.get(this.stage);

    if (!inputs) {
      try {
        withCMLScope((own) => {
          const declared = declaredBudgets(own(CML.Transaction.from_cbor_hex(tx)), own);

          assert.equal(
            declared.size,
            0,
            "Missing construction context for signed script transaction",
          );
        });

        return;
      } catch (error) {
        this.records.push({
          stage: this.stage,
          phase: "signed",
          cborSha256: cborHash(tx),
          accepted: false,
          error: String(error),
        });

        throw error;
      }
    }

    this.phase = "signed";

    try {
      await this.evaluate({ ...inputs, tx });
    } finally {
      this.phase = "construction";
    }
  }
}
