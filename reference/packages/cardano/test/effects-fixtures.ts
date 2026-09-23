/** Synthetic transaction, authorization and signing helpers for controlled wallet-review mutations. */
import { createPlan, input, output, type TransactionPlan } from "@ctvs/planning";
import { constr, encodeData, enterprise, hex, mintRedeemer, topUpRedeemer } from "@ctvs/protocol";
import {
  assetsToValue,
  CML,
  type CMLOwn,
  credentialToAddress,
  generateEmulatorAccountFromPrivateKey,
  type Script,
  toScriptRef,
  withCMLScope,
} from "@lucid-evolution/lucid";
import type { WalletAuthorization } from "../src/effects-types.js";

export const token = `${"ab".repeat(28)}.01`;

/**
 * Allocate a fresh signing identity and a fixed V3 program, returning plain values
 * while the caller's CML scope owns temporary handles. References are synthetic;
 * choosing indices 2 and 10 exposes lexicographic-versus-numeric pointer mistakes.
 */
function fixtureIdentities(own: CMLOwn) {
  const account = generateEmulatorAccountFromPrivateKey({ lovelace: 100_000_000n });
  const key = own(CML.PrivateKey.from_bech32(account.privateKey)),
    publicKey = own(key.to_public()),
    keyHash = own(publicKey.hash()).to_hex();
  const program = own(CML.PlutusV3Script.from_hex("480100002221200101")),
    policy = own(program.hash()).to_hex();
  const script: Script = { type: "PlutusV3", script: program.to_cbor_hex() };
  // Same transaction, indices 2 and 10: redeemer ordering must compare indices numerically.
  const stateRef = { txId: "11".repeat(32), index: 10n },
    fundingRef = { txId: "11".repeat(32), index: 2n },
    configRef = { txId: "22".repeat(32), index: 0n },
    scriptRef = { txId: "33".repeat(32), index: 0n };
  const stateAddress = credentialToAddress("Custom", { type: "Script", hash: policy });
  const stateRedeemer = topUpRedeemer(1_000_000n, 0n),
    issuance = mintRedeemer({ genesis: false, stateRef });

  return {
    account,
    keyHash,
    policy,
    script,
    stateRef,
    fundingRef,
    configRef,
    scriptRef,
    stateAddress,
    stateRedeemer,
    issuance,
  };
}

type FixtureIdentities = ReturnType<typeof fixtureIdentities>;

/**
 * Describe the effects expected by the wallet test, including a protected output,
 * mint delta and finite interval. The synthetic operation/datum combination is not
 * a valid CTVS lifecycle example and must not be used as proof of on-chain acceptance.
 */
function fixturePlan({
  policy,
  keyHash,
  stateRef,
  configRef,
  stateRedeemer,
  issuance,
}: FixtureIdentities): TransactionPlan {
  const plan = createPlan({
    operation: "top_up_reserve",
    deployment: {
      family: "ctvs1",
      claimScript: null,
      network: "fixture",
      networkDomain: "44".repeat(32),
      policy,
      configLock: "55".repeat(28),
      termsHash: "66".repeat(32),
      configRef,
      buildId: "effect-unit",
      chainPoint: { slot: 0n, blockHash: "77".repeat(32) },
    },
    inputs: [input(stateRef, "state", stateRedeemer)],
    referenceInputs: [configRef],
    outputs: [
      output(
        "state",
        { address: enterprise(policy), datum: constr(42, []) },
        { ada: 6_000_000n, [`${policy}.53`]: 7n },
      ),
    ],
    mint: [{ policy, assets: { "53": 7n }, redeemer: issuance }],
    requiredSigners: [keyHash],
    validity: {
      lowerPosixMs: 3_000n,
      upperPosixMs: 9_000n,
      lowerInclusive: true,
      upperExclusive: true,
    },
  });

  return plan;
}

/**
 * Independently provide the review policy and resolved input values, including one
 * funding UTxO also permitted as collateral. Normal change and collateral return
 * are distinct accounting paths, both retaining the unrelated native token.
 */
function fixtureAuthorization({
  account,
  script,
  stateRef,
  fundingRef,
  configRef,
  scriptRef,
  stateAddress,
}: FixtureIdentities): WalletAuthorization {
  const funding = {
    ref: fundingRef,
    address: account.address,
    value: { ada: 100_000_000n, [token]: 10n },
    referenceScript: null,
  };
  const auth: WalletAuthorization = {
    networkId: 0,
    networkName: "fixture",
    networkDomain: "44".repeat(32),
    planInputs: [
      { ref: stateRef, address: stateAddress, value: { ada: 5_000_000n }, referenceScript: null },
    ],
    allowedFundingInputs: [funding],
    allowedCollateralInputs: [funding],
    allowedReferenceInputs: [
      {
        ref: configRef,
        address: stateAddress,
        value: { ada: 2_000_000n },
        referenceScript: null,
      },
      {
        ref: scriptRef,
        address: account.address,
        value: { ada: 2_000_000n },
        referenceScript: script,
      },
    ],
    change: { address: account.address, datum: { kind: "none" } },
    maxNetworkFee: 2_000_000n,
    maxCollateralExposure: 2_000_000n,
    permittedExtraOutputs: [],
    additionalRequiredSigners: [],
    validitySlots: { lower: 3n, upper: 9n },
    slotConfig: { zeroTime: 0n, zeroSlot: 0n, slotLength: 1000n },
  };

  return auth;
}

/**
 * Construct parseable CBOR with balanced review effects and explicit spend/mint
 * pointers, without running ledger or Plutus validation. Script data hash and
 * execution units are placeholders: these tests exercise presence, matching and
 * approval binding rather than ledger correctness of those fields.
 */
function fixtureTransaction(
  own: CMLOwn,
  {
    account,
    keyHash,
    policy,
    stateRef,
    fundingRef,
    configRef,
    scriptRef,
    stateAddress,
    stateRedeemer,
    issuance,
  }: FixtureIdentities,
): string {
  const refs = (values: (typeof stateRef)[]) => {
    const result = own(CML.TransactionInputList.new());

    for (const ref of values)
      result.add(
        own(CML.TransactionInput.new(own(CML.TransactionHash.from_hex(ref.txId)), ref.index)),
      );

    return result;
  };

  const address = own(CML.Address.from_bech32(account.address)),
    outputs = own(CML.TransactionOutputList.new());

  outputs.add(
    own(
      CML.TransactionOutput.new(
        own(CML.Address.from_bech32(stateAddress)),
        own(assetsToValue({ lovelace: 6_000_000n, [`${policy}53`]: 7n })),
        CML.DatumOption.new_datum(
          own(CML.PlutusData.from_cbor_hex(hex(encodeData(constr(42, []))))),
        ),
      ),
    ),
  );
  outputs.add(
    own(
      CML.TransactionOutput.new(
        address,
        own(assetsToValue({ lovelace: 98_000_000n, [token.replace(".", "")]: 10n })),
      ),
    ),
  );

  const body = own(CML.TransactionBody.new(refs([fundingRef, stateRef]), outputs, 1_000_000n));

  body.set_reference_inputs(refs([configRef, scriptRef]));
  body.set_collateral_inputs(refs([fundingRef]));
  body.set_collateral_return(
    own(
      CML.TransactionOutput.new(
        address,
        own(assetsToValue({ lovelace: 99_000_000n, [token.replace(".", "")]: 10n })),
      ),
    ),
  );
  body.set_total_collateral(1_000_000n);
  body.set_network_id(own(CML.NetworkId.testnet()));
  body.set_validity_interval_start(3n);
  body.set_ttl(9n);
  // Deliberately not a ledger-computed hash; wallet review must not be described as validating it.
  body.set_script_data_hash(own(CML.ScriptDataHash.from_hex("00".repeat(32))));

  const signers = own(CML.Ed25519KeyHashList.new());

  signers.add(own(CML.Ed25519KeyHash.from_hex(keyHash)));
  body.set_required_signers(signers);

  const mint = own(CML.Mint.new());

  mint.set(own(CML.ScriptHash.from_hex(policy)), own(CML.AssetName.from_hex("53")), 7n);
  body.set_mint(mint);

  const witnesses = own(CML.TransactionWitnessSet.new()),
    redeemers = own(CML.LegacyRedeemerList.new());

  for (const [tag, index, data] of [
    [CML.RedeemerTag.Spend, 1n, stateRedeemer],
    [CML.RedeemerTag.Mint, 0n, issuance],
  ] as const)
    redeemers.add(
      own(
        CML.LegacyRedeemer.new(
          tag,
          index,
          own(CML.PlutusData.from_cbor_hex(hex(encodeData(data)))),
          own(CML.ExUnits.new(100n, 200n)),
        ),
      ),
    );

  witnesses.set_redeemers(own(CML.Redeemers.new_arr_legacy_redeemer(redeemers)));

  return own(CML.Transaction.new(body, witnesses, true)).to_cbor_hex();
}

/**
 * Return a self-consistent wallet-review fixture and its signing key as plain data.
 * The transaction is structurally parseable but is not backed by authenticated UTxOs
 * or valid CTVS execution. Each invocation owns/releases all temporary CML objects
 * and creates an independent account so mutation tests do not share authorization state.
 */
export function effectsFixture(): {
  cbor: string;
  plan: TransactionPlan;
  auth: WalletAuthorization;
  privateKey: string;
  script: Script;
} {
  return withCMLScope((own) => {
    const identities = fixtureIdentities(own);

    return {
      cbor: fixtureTransaction(own, identities),
      plan: fixturePlan(identities),
      auth: fixtureAuthorization(identities),
      privateKey: identities.account.privateKey,
      script: identities.script,
    };
  });
}

/**
 * Apply a targeted adversarial mutation to a parsed body JSON view and/or borrowed
 * witness set. Reuse the original body when JSON is unchanged so a witness-only test
 * cannot fail merely because CML reserialized the body. Return new CBOR and release
 * temporary handles; the callback must not retain the borrowed witness set.
 */
export function mutate(
  cbor: string,
  update: (body: Record<string, unknown>, witnesses: CML.TransactionWitnessSet) => void,
): string {
  return withCMLScope((own) => {
    const transaction = own(CML.Transaction.from_cbor_hex(cbor)),
      body = own(transaction.body()),
      witnesses = own(transaction.witness_set());
    const json: Record<string, unknown> = JSON.parse(body.to_json());
    const original = JSON.stringify(json);

    update(json, witnesses);

    const replacement = JSON.stringify(json);

    return own(
      CML.Transaction.new(
        replacement === original ? body : own(CML.TransactionBody.from_json(replacement)),
        witnesses,
        transaction.is_valid(),
      ),
    ).to_cbor_hex();
  });
}

/**
 * Replace vkey witnesses with one signature over the current fixture body while
 * preserving its non-key witnesses. This models the final signing step only;
 * signing a mutated body does not make it authorized or ledger-valid.
 */
export function signed(cbor: string, privateKey: string): string {
  return withCMLScope((own) => {
    const transaction = own(CML.Transaction.from_cbor_hex(cbor)),
      body = own(transaction.body()),
      witnesses = own(transaction.witness_set()),
      keys = own(CML.VkeywitnessList.new());

    keys.add(
      own(
        CML.make_vkey_witness(
          own(CML.hash_transaction(body)),
          own(CML.PrivateKey.from_bech32(privateKey)),
        ),
      ),
    );
    witnesses.set_vkeywitnesses(keys);

    return own(CML.Transaction.new(body, witnesses, true)).to_cbor_hex();
  });
}

/**
 * Replace attached V3 programs on a borrowed witness set to distinguish attached
 * script availability from reference-input availability. Reject a non-V3 fixture
 * program and release only the temporary script/list handles created here.
 */
export function setWitnessScript(witnesses: CML.TransactionWitnessSet, script: Script): void {
  withCMLScope((own) => {
    const list = own(CML.PlutusV3ScriptList.new()),
      reference = own(toScriptRef(script)),
      program = reference.as_plutus_v3();

    if (!program) throw new Error("expected Plutus V3 script");

    list.add(own(program));
    witnesses.set_plutus_v3_scripts(list);
  });
}
