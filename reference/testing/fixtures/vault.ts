/** Isolated signed-transaction fixtures with compiled vault scripts and synthetic native-asset balances. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AuthorizedOutput, ResolvedEffectInput, WalletAuthorization } from "@ctvs/cardano";
import { buildGenesisPlan as syncGenesis } from "@ctvs/ctvs1";
import { buildGenesisPlan as asyncGenesis } from "@ctvs/ctvs2";
import {
  type Deployment,
  type FamilyStateContext,
  type ProtectedInput,
  stateValue,
  type TransactionPlan,
} from "@ctvs/planning";
import * as protocol from "@ctvs/protocol";
import {
  applyParamsToScript,
  Data,
  Emulator,
  type EmulatorAccount,
  generateEmulatorAccountFromPrivateKey,
  getAddressDetails,
  Lucid,
  type LucidEvolution,
  type Script,
  type UTxO,
  validatorToAddress,
  validatorToScriptHash,
} from "@lucid-evolution/lucid";
import {
  findValidator,
  type Implementation,
  readBlueprint,
  referenceRoot,
  sha256,
} from "../../tools/lib/project.js";
import { constructPlan, type ScriptBindings } from "../ledger/builder.js";
import { RecordedEvaluator } from "../ledger/evaluator.js";
import { TransactionRecorder } from "../ledger/recorder.js";
import { asRef, datumHex, only, protocolValue } from "../ledger/serialization.js";

export type Underlying = "ada" | "native";
// Preloaded assets exercise custody, not the behavior of their external minting policies.
export const surplusUnit = `${"cd".repeat(28)}535552504c5553`;
export const nativeAsset = { policy: "ab".repeat(28), name: "554e4954" };

/**
 * Capture an ephemeral wallet policy before completion chooses funding or change.
 * Current wallet UTxOs may be both funding and collateral, while protected inputs
 * and reference scripts are resolved separately. These fixture fee/exposure limits
 * authorize a test attempt; they are not network fee estimates or protocol defaults.
 */
async function authorizeFixtureTransaction(
  lucid: LucidEvolution,
  emulator: Emulator,
  deployment: Deployment,
  plan: TransactionPlan | null,
  vaultReference: UTxO | null,
  permittedExtraOutputs: readonly AuthorizedOutput[],
): Promise<WalletAuthorization> {
  const resolved = (utxo: UTxO): ResolvedEffectInput => ({
    ref: asRef(utxo),
    address: utxo.address,
    value: protocolValue(utxo.assets),
    referenceScript: utxo.scriptRef ?? null,
  });

  const lookup = async (ref: protocol.OutRef) =>
    resolved(
      only(
        await emulator.getUtxosByOutRef([{ txHash: ref.txId, outputIndex: Number(ref.index) }]),
        "Missing authorized UTxO",
      ),
    );

  const walletInputs = (await lucid.wallet().getUtxos()).map(resolved);
  const references = await Promise.all((plan?.referenceInputs ?? []).map(lookup));
  const needsVault =
    plan &&
    (plan.mint.length > 0 ||
      plan.inputs.some((input) => input.role === "state" || input.role === "request"));

  if (needsVault && vaultReference) references.push(resolved(vaultReference));

  const slots = lucid.config().slotConfig;

  assert.ok(slots);

  return {
    networkId: 0,
    networkName: deployment.network,
    networkDomain: deployment.networkDomain,
    planInputs: await Promise.all((plan?.inputs ?? []).map((input) => lookup(input.ref))),
    allowedFundingInputs: walletInputs,
    allowedCollateralInputs: walletInputs,
    allowedReferenceInputs: references,
    change: { address: await lucid.wallet().address(), datum: { kind: "none" } },
    maxNetworkFee: 5_000_000n,
    maxCollateralExposure: 10_000_000n,
    permittedExtraOutputs,
    additionalRequiredSigners: [],
    validitySlots: {
      lower: plan?.validity
        ? BigInt(lucid.unixTimeToSlot(Number(plan.validity.lowerPosixMs)))
        : null,
      upper: plan?.validity
        ? BigInt(lucid.unixTimeToSlot(Number(plan.validity.upperPosixMs)))
        : null,
    },
    slotConfig: {
      zeroTime: BigInt(slots.zeroTime),
      zeroSlot: BigInt(slots.zeroSlot),
      slotLength: BigInt(slots.slotLength),
    },
  };
}

/**
 * One isolated ledger, wallet and deployed family used through a complete scenario.
 * State is looked up afresh by its identity token so successive plans do not reuse
 * a spent snapshot. The fixture deliberately holds signing authority and synthetic
 * balances; production planners do not have those responsibilities.
 */
export class VaultFixture {
  constructor(
    readonly implementation: Implementation,
    readonly underlying: Underlying,
    readonly lucid: LucidEvolution,
    readonly emulator: Emulator,
    readonly recorder: TransactionRecorder,
    readonly user: EmulatorAccount,
    readonly publisher: EmulatorAccount,
    readonly terms: protocol.Terms,
    readonly deployment: Deployment,
    readonly scripts: ScriptBindings,
    readonly vaultAddress: string,
    readonly configAddress: string,
    readonly receiver: protocol.Destination,
  ) {}

  get policy(): string {
    return this.deployment.policy;
  }

  get stateUnit(): string {
    return this.policy + protocol.NAMES.state;
  }

  get idUnit(): string {
    return this.policy + protocol.NAMES.id;
  }

  get shareUnit(): string {
    return this.policy + protocol.NAMES.share;
  }

  get userKey(): string {
    return this.receiver.address.payment.hash;
  }

  async output(txId: string, index = 0): Promise<UTxO> {
    return only(
      await this.emulator.getUtxosByOutRef([{ txHash: txId, outputIndex: index }]),
      "Expected output",
    );
  }

  /**
   * Adapt a known fixture output to the planner's protected-input representation.
   * It assumes fixture-controlled enterprise script outputs; external callers must
   * validate address form, datum mode and reference scripts before trusting evidence.
   */
  async protectedInput(utxo: UTxO): Promise<ProtectedInput> {
    assert.ok(utxo.datum, "expected inline datum");

    return {
      ref: asRef(utxo),
      address: protocol.enterprise(getAddressDetails(utxo.address).paymentCredential?.hash ?? ""),
      datum: protocol.decodeData(utxo.datum),
      datumMode: "inline",
      referenceScript: null,
      value: protocolValue(utxo.assets),
    };
  }

  /** Resolve the currently unspent State and assert that physical custody matches its accounting partitions. */
  async stateInput(): Promise<ProtectedInput> {
    const utxo = await this.emulator.getUtxoByUnit(this.stateUnit);
    const source = await this.protectedInput(utxo);
    const state = protocol.stateFromData(source.datum);

    assert.deepEqual(
      source.value,
      stateValue(state, this.terms),
      "actual custody must equal recorded partitions",
    );

    return source;
  }

  async syncContext(): Promise<FamilyStateContext<"ctvs1">> {
    assert.equal(this.deployment.family, "ctvs1");

    if (this.deployment.family !== "ctvs1") throw new Error("Wrong implementation");

    return { deployment: this.deployment, terms: this.terms, stateInput: await this.stateInput() };
  }

  async asyncContext(): Promise<FamilyStateContext<"ctvs2">> {
    if (this.deployment.family !== "ctvs2") throw new Error("Wrong implementation");

    return { deployment: this.deployment, terms: this.terms, stateInput: await this.stateInput() };
  }

  /**
   * Authorize, construct, sign and submit one plan, then read back any successor State.
   * The readback checks both datum and full value against intent, making later
   * operations consume observed ledger state rather than a predicted successor.
   */
  async submit(stage: string, plan: TransactionPlan): Promise<string> {
    const authorization = await this.authorize(plan);
    const txId = await this.recorder.submit(
      stage,
      await constructPlan(this.lucid, this.emulator, this.scripts, plan),
      { plan, authorization },
    );
    const expected = plan.outputs.find((output) => output.role === "state");

    if (expected) {
      const actual = await this.stateInput();

      assert.ok(protocol.equalData(actual.datum, expected.datum ?? 0n));
      assert.deepEqual(actual.value, expected.value);
      this.recorder.write(`${stage}-state`, actual);
    }

    this.recorder.finish();

    return txId;
  }

  authorize(
    plan: TransactionPlan | null,
    permittedExtraOutputs: readonly AuthorizedOutput[] = [],
  ): Promise<WalletAuthorization> {
    return authorizeFixtureTransaction(
      this.lucid,
      this.emulator,
      this.deployment,
      plan,
      this.scripts.vaultReference,
      permittedExtraOutputs,
    );
  }

  /** Prove a compiled rejection and that no State mutation leaked from the unsuccessful attempt. */
  async reject(stage: string, plan: TransactionPlan): Promise<void> {
    const before = await this.stateInput();

    await this.recorder.reject(
      stage,
      await constructPlan(this.lucid, this.emulator, this.scripts, plan),
    );
    assert.deepEqual(await this.stateInput(), before, "rejected transaction must preserve State");
    this.recorder.finish();
  }
}

/**
 * Create separate user/publisher wallets and pin the resource envelope used by tests.
 * Native assets are preloaded rather than minted through external policies; this
 * setup can test vault custody but cannot establish those policies' correctness.
 */
async function createEmulatorContext(underlying: Underlying) {
  const user = generateEmulatorAccountFromPrivateKey({
    lovelace: 1_000_000_000_000n,
    [surplusUnit]: 1_000_000n,
    ...(underlying === "native"
      ? { [nativeAsset.policy + nativeAsset.name]: 1_000_000_000_000n }
      : {}),
  });
  const publisher = generateEmulatorAccountFromPrivateKey({ lovelace: 1_000_000_000_000n });
  const emulator = new Emulator([user, publisher]);
  const evaluator = new RecordedEvaluator();
  const lucid = await Lucid(emulator, "Custom", { evaluator });
  const parameters = await emulator.getProtocolParameters();

  // Resource-sensitive scenarios must not silently change when emulator defaults are upgraded.
  assert.equal(parameters.maxTxSize, 16384);
  assert.equal(parameters.maxTxExMem, 14_000_000n);
  assert.equal(parameters.maxTxExSteps, 10_000_000_000n);

  const seed = only(await emulator.getUtxos(user.address), "Expected one bootstrap UTxO");
  const userKey = getAddressDetails(user.address).paymentCredential?.hash;

  assert.ok(userKey);

  const receiver = { address: protocol.enterprise(userKey, "key"), datum: null };

  return { user, publisher, emulator, evaluator, lucid, parameters, seed, userKey, receiver };
}

type EmulatorContext = Awaited<ReturnType<typeof createEmulatorContext>>;

/**
 * Apply real compiled script parameters using local Terms and the untouched user seed.
 * configRef is temporarily the seed because the Config output does not exist yet;
 * createVault replaces it with the accepted genesis output before returning.
 */
function createFixtureDeployment(
  implementation: Implementation,
  underlying: Underlying,
  { seed, userKey, receiver, emulator }: EmulatorContext,
) {
  const artifactPath = join(referenceRoot, "artifacts", implementation);
  const blueprintPath = join(artifactPath, "blueprint.json");
  const blueprint = readBlueprint(blueprintPath);
  const configTemplate = findValidator(blueprint, "config_lock.config_lock.spend");
  const vaultTemplate = findValidator(blueprint, "vault.vault.spend");
  const asset: protocol.Asset = underlying === "ada" ? "ada" : nativeAsset;
  const terms: protocol.Terms = {
    profile: 0n,
    networkDomain: protocol.hex(
      protocol.blake2b256(Buffer.from("CTVS/isolated-lucid-emulator/v2")),
    ),
    underlying: asset,
    virtualShares: 1n,
    maxBacking: null,
    entryBps: 100n,
    exitBps: 100n,
    feeDestination: receiver,
    pauseKey: userKey,
    settlers: null,
    executionModes: implementation === "ctvs1" ? 3n : 12n,
    maxBatch: 16n,
    descriptorHash: null,
  };
  const termsHash = protocol.termsHash(terms);
  const vault: Script = {
    type: "PlutusV3",
    script: applyParamsToScript(vaultTemplate.compiledCode, [
      Data.from<Data>(datumHex(protocol.outRefData(asRef(seed)))),
      termsHash,
    ]),
  };
  const config: Script = { type: "PlutusV3", script: configTemplate.compiledCode };
  const claim: Script | null =
    implementation === "ctvs2"
      ? {
          type: "PlutusV3",
          script: findValidator(blueprint, "claim.claim_guard.spend").compiledCode,
        }
      : null;
  const baseDeployment = {
    network: "isolated-lucid-emulator",
    networkDomain: terms.networkDomain,
    policy: validatorToScriptHash(vault),
    configLock: validatorToScriptHash(config),
    termsHash,
    configRef: asRef(seed),
    buildId: sha256(readFileSync(blueprintPath)),
    chainPoint: { slot: BigInt(emulator.slot), blockHash: "00".repeat(32) },
  };
  const deployment: Deployment =
    claim === null
      ? { ...baseDeployment, family: "ctvs1", claimScript: null }
      : { ...baseDeployment, family: "ctvs2", claimScript: validatorToScriptHash(claim) };

  return { terms, deployment, vault, config, claim };
}

/**
 * Fund and sign a separate reference-script publication before genesis.
 * The publisher's wallet prevents funding selection from consuming the bound user
 * seed. On success, switch back to the user wallet for the subsequent genesis spend.
 */
async function publishVaultScript(
  { lucid, emulator, publisher, user }: EmulatorContext,
  deployment: Deployment,
  vault: Script,
  recorder: TransactionRecorder,
): Promise<UTxO> {
  // The separate publisher preserves the user's seed UTxO for parameter-bound genesis.
  lucid.selectWallet.fromPrivateKey(publisher.privateKey);

  const publicationAuthorization = await authorizeFixtureTransaction(
    lucid,
    emulator,
    deployment,
    null,
    null,
    [
      {
        address: publisher.address,
        value: { ada: 100_000_000n },
        datum: { kind: "none" },
        referenceScript: vault,
      },
    ],
  );
  const publication = await recorder.submit(
    "publish",
    lucid
      .newTx()
      .pay.ToAddressWithData(publisher.address, undefined, { lovelace: 100_000_000n }, vault),
    { plan: null, authorization: publicationAuthorization },
  );
  const vaultReference = only(
    await emulator.getUtxosByOutRef([{ txHash: publication, outputIndex: 0 }]),
    "Missing reference script",
  );

  lucid.selectWallet.fromPrivateKey(user.privateKey);

  return vaultReference;
}

/**
 * Produce a usable isolated vault through real local publication and genesis transactions.
 * Blueprint artifacts must already be built for the selected family. Only after
 * accepted genesis is the placeholder Config reference replaced and the fixture
 * returned, so later planners can authenticate the actual immutable Config output.
 */
export async function createVault(
  implementation: Implementation,
  underlying: Underlying,
  testName: string,
): Promise<VaultFixture> {
  const environment = await createEmulatorContext(underlying);
  const { user, publisher, emulator, evaluator, lucid, parameters, seed, receiver } = environment;
  const { terms, deployment, vault, config, claim } = createFixtureDeployment(
    implementation,
    underlying,
    environment,
  );
  const recorder = new TransactionRecorder(
    join(referenceRoot, "artifacts/integration", implementation, underlying, testName),
    emulator,
    parameters,
    evaluator,
  );

  recorder.write("implementation", {
    deployment,
    terms,
    protocolParameters: parameters,
    appliedScript: vault,
    blueprintSha256: deployment.buildId,
    candidateAssets: "Synthetic emulator balances; external native policies not tested",
  });

  const vaultReference = await publishVaultScript(environment, deployment, vault, recorder);

  const fixture = new VaultFixture(
    implementation,
    underlying,
    lucid,
    emulator,
    recorder,
    user,
    publisher,
    terms,
    deployment,
    { vaultReference, claim },
    validatorToAddress("Custom", vault),
    validatorToAddress("Custom", config),
    receiver,
  );
  const genesis =
    deployment.family === "ctvs1"
      ? syncGenesis({
          deployment,
          terms,
          seed: asRef(seed),
          configReserve: 10_000_000n,
          stateReserve: 10_000_000n,
        })
      : asyncGenesis({
          deployment,
          terms,
          seed: asRef(seed),
          configReserve: 10_000_000n,
          stateReserve: 10_000_000n,
        });
  const genesisId = await fixture.submit("genesis", genesis);

  deployment.configRef = asRef(await fixture.output(genesisId));

  return fixture;
}
