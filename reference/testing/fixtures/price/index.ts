/** Build actual signed transactions using either witnesses or published reference programs. */
import assert from "node:assert/strict";
import * as p from "@ctvs/protocol";
import {
  Emulator,
  generateEmulatorAccountFromPrivateKey,
  getAddressDetails,
  Lucid,
  type LucidEvolution,
  mintingPolicyToId,
  type Provider,
  scriptFromNative,
  type TxBuilder,
  type UTxO,
  validatorToRewardAddress,
} from "@lucid-evolution/lucid";
import { RecordedEvaluator } from "../../ledger/evaluator.js";
import { asRef, datumHex, only } from "../../ledger/serialization.js";
import { submitPrice, writePriceEvidence } from "./record.js";
import { BACKING, priceScripts, RECEIPTS, SUPPLY, VALUE } from "./scripts.js";

export type CodeSource = "witness" | "reference";

export class PriceFixture {
  position!: UTxO;
  state!: UTxO;
  code: UTxO[] = [];

  constructor(
    readonly lucid: LucidEvolution,
    readonly provider: Provider,
    readonly scripts: ReturnType<typeof priceScripts>,
    readonly directory: string,
    readonly advance: () => Promise<void>,
    readonly evaluator: RecordedEvaluator,
  ) {}

  async submit(stage: string, tx: TxBuilder): Promise<string> {
    const id = await submitPrice(this.provider, this.evaluator, this.directory, stage, tx);

    await this.advance();
    assert.ok(await this.provider.awaitTx(id, 1000), "Submitted transaction not observed");

    return id;
  }

  claim(
    assertions: p.PriceAssertion[] = [{ kind: "ConvertToAssets", shares: RECEIPTS, assets: VALUE }],
  ): p.Price {
    return {
      version: 1n,
      marketId: this.scripts.market,
      shareAsset: this.scripts.receipt,
      underlyingAsset: this.scripts.underlying,
      assertions,
      evidence: p.constr(0, [p.outRefData(asRef(this.state))]),
    };
  }

  checkpoint(source: CodeSource, claim = this.claim(), value = VALUE, keep = RECEIPTS): TxBuilder {
    const tx = this.lucid
      .newTx()
      .collectFrom([this.position], datumHex(p.constr(0, [0n])))
      .readFrom([this.state])
      .withdraw(
        validatorToRewardAddress("Custom", this.scripts.provider),
        0n,
        datumHex(p.priceToData(claim)),
      )
      .pay.ToContract(
        this.scripts.consumerAddress,
        { kind: "inline", value: datumHex(p.constr(0, [value])) },
        {
          ...this.position.assets,
          [this.scripts.receipt.policy + this.scripts.receipt.name]: keep,
        },
      );

    if (source === "reference") return tx.readFrom(this.code);

    return tx.attach
      .SpendingValidator(this.scripts.consumer)
      .attach.WithdrawalValidator(this.scripts.provider);
  }

  async reject(stage: string, tx: TxBuilder): Promise<void> {
    this.evaluator.stage = stage;

    const before = await this.provider.getUtxosByOutRef([this.position]);
    let rejected = false;

    try {
      await tx.complete({ localUPLCEval: true });
    } catch {
      rejected = true;
    }

    assert.ok(rejected, "Expected compiled script rejection");
    assert.ok(
      this.evaluator.records.some((r) => r.stage === stage && !r.accepted),
      "Must reach actual phase-two execution, not merely builder validation",
    );
    assert.deepEqual(await this.provider.getUtxosByOutRef([this.position]), before);
    writePriceEvidence(
      this.directory,
      stage,
      this.evaluator.records.filter((r) => r.stage === stage),
    );
  }

  /** Replace the issuer-controlled state, preserving identity while burning lost backing. */
  async replaceState(): Promise<void> {
    const backing = 1_000_000_000_000n;
    const unit = this.scripts.underlying.policy + this.scripts.underlying.name;
    const id = await this.submit(
      "replace-state",
      this.lucid
        .newTx()
        .collectFrom([this.state])
        .attach.SpendingValidator(this.scripts.nativeState)
        .mintAssets({ [unit]: backing - BACKING })
        .attach.MintingPolicy(this.scripts.nativeState)
        .pay.ToContract(
          this.scripts.stateAddress,
          { kind: "inline", value: datumHex(p.constr(0, [backing, SUPPLY])) },
          { ...this.state.assets, [unit]: backing },
        ),
    );

    this.state = only(
      await this.provider.getUtxosByOutRef([{ txHash: id, outputIndex: 0 }]),
      "Missing replacement",
    );
  }
}

/** Native minting and state policies are test-issuer controlled, not a production market implementation. */
export async function createPriceFixture(directory: string): Promise<PriceFixture> {
  const account = generateEmulatorAccountFromPrivateKey({ lovelace: 3_000_000_000n });
  const emulator = new Emulator([account]);
  const evaluator = new RecordedEvaluator();
  const lucid = await Lucid(emulator, "Custom", { evaluator });

  lucid.selectWallet.fromPrivateKey(account.privateKey);

  return bootstrapPrice(lucid, emulator, directory, evaluator, async () => {
    emulator.awaitBlock(1);
  });
}

/** Shared setup for local and node-backed fixtures, with caller-owned transport and signing. */
export async function bootstrapPrice(
  lucid: LucidEvolution,
  provider: Provider,
  directory: string,
  evaluator: RecordedEvaluator,
  advance: () => Promise<void>,
): Promise<PriceFixture> {
  const address = await lucid.wallet().address();
  const key = getAddressDetails(address).paymentCredential?.hash;

  assert.ok(key);

  const native = scriptFromNative({ type: "sig", keyHash: key });
  const scripts = priceScripts(mintingPolicyToId(native), native);
  const fixture = new PriceFixture(lucid, provider, scripts, directory, advance, evaluator);
  const units = {
    [scripts.market.policy + scripts.market.name]: 1n,
    [scripts.receipt.policy + scripts.receipt.name]: RECEIPTS,
    [scripts.underlying.policy + scripts.underlying.name]: BACKING,
  };
  const setup = lucid
    .newTx()
    .mintAssets(units)
    .attach.MintingPolicy(native)
    .register.Stake(validatorToRewardAddress("Custom", scripts.provider))
    .pay.ToContract(
      scripts.stateAddress,
      { kind: "inline", value: datumHex(p.constr(0, [BACKING, SUPPLY])) },
      {
        lovelace: 5_000_000n,
        [scripts.market.policy + scripts.market.name]: 1n,
        [scripts.underlying.policy + scripts.underlying.name]: BACKING,
      },
    )
    .pay.ToContract(
      scripts.consumerAddress,
      { kind: "inline", value: datumHex(p.constr(0, [0n])) },
      { lovelace: 5_000_000n, [scripts.receipt.policy + scripts.receipt.name]: RECEIPTS },
    );
  const id = await fixture.submit("setup", setup);

  fixture.state = only(
    await provider.getUtxosByOutRef([{ txHash: id, outputIndex: 0 }]),
    "Missing state",
  );
  fixture.position = only(
    await provider.getUtxosByOutRef([{ txHash: id, outputIndex: 1 }]),
    "Missing position",
  );

  const pub = await fixture.submit(
    "publish",
    lucid
      .newTx()
      .pay.ToAddressWithData(address, undefined, { lovelace: 50_000_000n }, scripts.provider)
      .pay.ToAddressWithData(address, undefined, { lovelace: 50_000_000n }, scripts.consumer),
  );

  fixture.code = await provider.getUtxosByOutRef(
    [0, 1].map((outputIndex) => ({ txHash: pub, outputIndex })),
  );
  writePriceEvidence(directory, "binding", {
    ...scripts,
    units: { receiptDecimals: 8, underlyingDecimals: 6 },
    state: asRef(fixture.state),
    code: fixture.code.map(asRef),
    source: "issuer-controlled fixture",
  });

  return fixture;
}
