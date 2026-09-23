/** Records signed local submissions and their evaluation inputs; these artifacts are not node-acceptance receipts. */
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertApprovedTransaction,
  verifyTransactionEffects,
  type WalletAuthorization,
} from "@ctvs/cardano";
import type { TransactionPlan } from "@ctvs/planning";
import {
  CML,
  type Emulator,
  type ProtocolParameters,
  type TxBuilder,
} from "@lucid-evolution/lucid";
import type { RecordedEvaluator } from "./evaluator.js";

export interface TransactionRecord {
  stage: string;
  txId: string;
  bytes: number;
  fee: bigint;
  witnesses: string[];
  requiredSigners: string[];
  signedCbor: string;
}

/**
 * Own the evidence directory for one isolated integration scenario. Construction,
 * wallet approval, cryptographic witnesses and final Plutus evaluation all precede
 * local submission; rejected candidates are recorded separately from accepted IDs.
 * Creating a recorder clears its directory, so scenarios must use distinct paths.
 */
export class TransactionRecorder {
  readonly accepted: TransactionRecord[] = [];
  readonly rejected: string[] = [];

  constructor(
    readonly directory: string,
    readonly emulator: Emulator,
    readonly parameters: ProtocolParameters,
    readonly evaluator: RecordedEvaluator,
  ) {
    rmSync(directory, { recursive: true, force: true });
  }

  write(name: string, data: unknown): void {
    mkdirSync(this.directory, { recursive: true });
    writeFileSync(
      join(this.directory, `${name}.json`),
      `${JSON.stringify(data, (_, value: unknown) => (typeof value === "bigint" ? value.toString() : value), 2)}\n`,
    );
  }

  /**
   * Complete and review a candidate before signing, then verify signatures against
   * the exact approved body. Only after final-CBOR evaluation succeeds is it submitted
   * to the Emulator and included in a local block. The saved context supports later
   * inspection of inputs and costs; it is not an independent node receipt.
   */
  async submit(
    stage: string,
    builder: TxBuilder,
    approved: { plan: TransactionPlan | null; authorization: WalletAuthorization },
  ): Promise<string> {
    this.evaluator.stage = stage;

    const built = await builder.complete({ localUPLCEval: true });
    const approval = verifyTransactionEffects(
      built.toCBOR(),
      approved.plan,
      approved.authorization,
    );
    const signed = await built.sign.withWallet().complete();
    const signedCbor = signed.toCBOR(),
      txId = signed.toHash();

    assertApprovedTransaction(signedCbor, approval);

    const tx = CML.Transaction.from_cbor_hex(signedCbor),
      body = tx.body(),
      witnessSet = tx.witness_set();

    try {
      assert.ok(
        signedCbor.length / 2 <= this.parameters.maxTxSize,
        "transaction exceeds protocol size ceiling",
      );

      const witnesses: string[] = [],
        requiredSigners: string[] = [];
      const keys = witnessSet.vkeywitnesses();

      assert.ok(keys && keys.len() > 0, "expected actual key witnesses");

      try {
        for (let index = 0; index < keys.len(); index++) {
          const witness = keys.get(index),
            key = witness.vkey(),
            signature = witness.ed25519_signature(),
            hash = key.hash();

          try {
            assert.ok(key.verify(Buffer.from(txId, "hex"), signature));
            witnesses.push(hash.to_hex());
          } finally {
            hash.free();
            signature.free();
            key.free();
            witness.free();
          }
        }
      } finally {
        keys.free();
      }

      const signers = body.required_signers();

      if (signers) {
        try {
          for (let index = 0; index < signers.len(); index++) {
            const hash = signers.get(index);

            requiredSigners.push(hash.to_hex());
            hash.free();
          }
        } finally {
          signers.free();
        }
      }

      for (const key of requiredSigners)
        assert.ok(witnesses.includes(key), "missing required cryptographic witness");

      await this.evaluator.verifySigned(signedCbor);

      const result = {
        stage,
        txId,
        bytes: signedCbor.length / 2,
        fee: body.fee(),
        witnesses,
        requiredSigners,
        signedCbor,
      };

      assert.equal(await signed.submit(), txId);
      this.emulator.awaitBlock(1);
      this.accepted.push(result);

      const evaluation = this.evaluator.inputs.get(stage);

      this.write(stage, {
        ...result,
        approval,
        evaluations: this.evaluator.records.filter((record) => record.stage === stage),
        resolvedInputs: evaluation?.additionalUTxOs,
        costModelsCbor: evaluation?.context.costModels.to_cbor_hex(),
        slotConfig: evaluation?.context.slotConfig,
      });

      return txId;
    } finally {
      witnessSet.free();
      body.free();
      tx.free();
    }
  }

  /**
   * Require construction to fail after reaching the compiled evaluator and retain
   * that failure's inputs/CBOR. A balancing, funding or other builder error alone
   * does not establish that the intended validator rejected the candidate.
   */
  async reject(stage: string, builder: TxBuilder): Promise<void> {
    this.evaluator.stage = stage;
    await assert.rejects(() => builder.complete({ localUPLCEval: true }));

    const failure = this.evaluator.records.find(
      (record) => record.stage === stage && !record.accepted,
    );

    assert.ok(failure, "negative test must reach the compiled Plutus evaluator");
    this.rejected.push(stage);

    const input = this.evaluator.inputs.get(stage);

    this.write(stage, { failure, cbor: input?.tx, resolvedInputs: input?.additionalUTxOs });
  }

  /** Consolidate evidence from this scenario without interpreting a partial run as a complete lifecycle. */
  finish(): void {
    this.write("report", {
      environment: "local Lucid Emulator with pinned Aiken/WASM phase-two evaluation",
      networkSubmission: false,
      protocolParameters: this.parameters,
      accepted: this.accepted.map(({ signedCbor: _, ...summary }) => summary),
      rejected: this.rejected,
      evaluations: this.evaluator.records,
    });
  }
}
