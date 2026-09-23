/** Exercises wallet authorization and post-signing tamper checks with synthetic CBOR and a balanced Lucid payment. */
import { createPlan, output } from "@ctvs/planning";
import { constr, enterprise } from "@ctvs/protocol";
import {
  CML,
  Emulator,
  generateEmulatorAccountFromPrivateKey,
  getAddressDetails,
  Lucid,
  withCMLScope,
} from "@lucid-evolution/lucid";
import { describe, expect, it } from "vitest";
import {
  assertApprovedTransaction,
  verifyTransactionEffects,
  type WalletAuthorization,
} from "../src/effects.js";
import { effectsFixture, mutate, setWitnessScript, signed, token } from "./effects-fixtures.js";

describe("complete wallet effects", () => {
  it("rejects a non-bigint authorized reference through the canonical protocol validator", () => {
    const { cbor, plan, auth } = effectsFixture();
    const input = auth.allowedFundingInputs[0];

    if (!input) throw new Error("missing funding fixture");

    // @ts-expect-error Runtime authorization input must satisfy the protocol bigint contract.
    input.ref.index = Number(input.ref.index);
    expect(() => verifyTransactionEffects(cbor, plan, auth)).toThrow(/output index/);
  });
});

describe("complete wallet effects", () => {
  it("approves a real balanced Lucid payment and binds its signed body", async () => {
    // This case uses a real balancer/signing path for a key payment. The plan supplies wallet
    // expectations; the operation label does not turn the payment into a CTVS execution test.
    const user = generateEmulatorAccountFromPrivateKey({ lovelace: 200_000_000n }),
      recipient = generateEmulatorAccountFromPrivateKey({ lovelace: 1n });
    const emulator = new Emulator([user]),
      lucid = await Lucid(emulator, "Custom");

    lucid.selectWallet.fromPrivateKey(user.privateKey);

    const walletInputs = (await lucid.wallet().getUtxos()).map((utxo) => ({
      ref: { txId: utxo.txHash, index: BigInt(utxo.outputIndex) },
      address: utxo.address,
      value: { ada: utxo.assets.lovelace ?? 0n },
      referenceScript: null,
    }));
    const key = getAddressDetails(user.address).paymentCredential?.hash;

    if (!key) throw new Error("missing wallet key");

    const plan = createPlan({
      operation: "create_request",
      deployment: {
        family: "ctvs1",
        claimScript: null,
        network: "fixture",
        networkDomain: "44".repeat(32),
        policy: "11".repeat(28),
        configLock: "22".repeat(28),
        termsHash: "33".repeat(32),
        configRef: { txId: "55".repeat(32), index: 0n },
        buildId: "unit",
        chainPoint: { slot: 0n, blockHash: "66".repeat(32) },
      },
      inputs: [],
      referenceInputs: [],
      outputs: [
        output("receiver", { address: enterprise(key, "key"), datum: null }, { ada: 5_000_000n }),
      ],
    });
    const auth: WalletAuthorization = {
      networkId: 0,
      networkName: "fixture",
      networkDomain: "44".repeat(32),
      planInputs: [],
      allowedFundingInputs: walletInputs,
      allowedCollateralInputs: [],
      allowedReferenceInputs: [],
      change: { address: user.address, datum: { kind: "none" } },
      maxNetworkFee: 2_000_000n,
      maxCollateralExposure: 0n,
      permittedExtraOutputs: [],
      additionalRequiredSigners: [],
      validitySlots: { lower: null, upper: null },
      slotConfig: { zeroTime: 0n, zeroSlot: 0n, slotLength: 1000n },
    };

    const builder = () => lucid.newTx().pay.ToAddress(user.address, { lovelace: 5_000_000n });

    const built = await builder().complete(),
      approval = verifyTransactionEffects(built.toCBOR(), plan, auth),
      complete = await built.sign.withWallet().complete();

    expect(() => assertApprovedTransaction(complete.toCBOR(), approval)).not.toThrow();
    expect(approval.effects.outputs.map((item) => item.role)).toEqual(["protected", "change"]);

    // Rebuilding with a new recipient must fail until that exact output is independently authorized.
    const changed = await builder()
      .pay.ToAddress(recipient.address, { lovelace: 50_000_000n })
      .complete();

    expect(() => verifyTransactionEffects(changed.toCBOR(), plan, auth)).toThrow(
      /unapproved output/,
    );

    const permitted = {
      ...auth,
      permittedExtraOutputs: [
        {
          address: recipient.address,
          value: { ada: 50_000_000n },
          datum: { kind: "none" as const },
          referenceScript: null,
        },
      ],
    };

    expect(
      verifyTransactionEffects(changed.toCBOR(), plan, permitted).effects.outputs.map(
        (item) => item.role,
      ),
    ).toEqual(["protected", "permitted", "change"]);
    expect(() =>
      assertApprovedTransaction(
        complete.toCBOR(),
        verifyTransactionEffects(changed.toCBOR(), plan, permitted),
      ),
    ).toThrow(/body changed/);
    expect(() => verifyTransactionEffects(built.toCBOR(), plan, permitted)).toThrow(
      /missing explicitly authorized/,
    );
    expect(() =>
      verifyTransactionEffects(built.toCBOR(), plan, { ...auth, maxNetworkFee: 1n }),
    ).toThrow(/network fee/);
    expect(() =>
      verifyTransactionEffects(built.toCBOR(), plan, { ...auth, allowedFundingInputs: [] }),
    ).toThrow(/unapproved funding/);
  });
});

describe("complete wallet effects", () => {
  it("accounts for token change, script references, sorted redeemers and overlapping collateral", () => {
    const { cbor, plan, auth, privateKey } = effectsFixture(),
      approval = verifyTransactionEffects(cbor, plan, auth);

    expect(approval.collateralExposure).toBe(1_000_000n);
    expect(approval.effects.collateralReturn?.value[token]).toBe(10n);
    expect(approval.fundingInputs).toEqual([`${"11".repeat(32)}#2`]);
    expect(() => assertApprovedTransaction(signed(cbor, privateKey), approval)).not.toThrow();
    expect(() => assertApprovedTransaction(cbor, approval)).toThrow(/missing authorized input/);
  });

  it.each([
    ["fee cap", { fee: 3_000_000 }, /network fee/],
    ["fee value loss inside cap", { fee: 1_000_001 }, /conserve value/],
    ["network", { network_id: { network: 1 } }, /network ID/],
    ["lower bound", { validity_interval_start: 4 }, /validity slots/],
    ["upper bound", { ttl: 10 }, /validity slots/],
    ["missing planned input", { inputs: [] }, /missing planned input/],
    [
      "foreign funding",
      {
        inputs: [
          { transaction_id: "11".repeat(32), index: 10 },
          { transaction_id: "aa".repeat(32), index: 0 },
        ],
      },
      /unapproved funding/,
    ],
    ["missing reference", { reference_inputs: [] }, /missing planned reference/],
    [
      "foreign reference",
      { reference_inputs: [{ transaction_id: "aa".repeat(32), index: 0 }] },
      /unapproved or overlapping reference/,
    ],
    [
      "unapproved collateral",
      { collateral_inputs: [{ transaction_id: "aa".repeat(32), index: 0 }] },
      /unapproved collateral/,
    ],
    ["missing required signer", { required_signers: [] }, /required signers/],
    ["foreign required signer", { required_signers: ["aa".repeat(28)] }, /required signers/],
    ["donation", { donation: 1 }, /unapproved auxiliary/],
    ["treasury", { current_treasury_value: 1 }, /unapproved auxiliary/],
    ["metadata hash", { auxiliary_data_hash: "aa".repeat(32) }, /unapproved auxiliary/],
    ["removed mint", { mint: null }, /mint quantities/],
    ["missing script data hash", { script_data_hash: null }, /script-data hash presence/],
    ["missing protected output", { outputs: [] }, /missing protected output/],
    ["wrong total collateral", { total_collateral: 1_000_001 }, /total collateral/],
    [
      "collateral without inputs",
      { collateral_inputs: null },
      /collateral return must preserve|collateral exposure|collateral fields/,
    ],
  ] as const)("rejects %s", (_, fields, error) => {
    const { cbor, plan, auth } = effectsFixture();

    expect(() =>
      verifyTransactionEffects(
        mutate(cbor, (body) => Object.assign(body, fields)),
        plan,
        auth,
      ),
    ).toThrow(error);
  });

  it("rejects unauthorized collateral loss, token loss and altered return destination", () => {
    // Collateral failure must not be judged using normal change: net ADA and every native asset
    // are checked against the separate return output, even when funding/collateral share one UTxO.
    const { cbor, plan, auth } = effectsFixture();

    expect(() =>
      verifyTransactionEffects(cbor, plan, { ...auth, maxCollateralExposure: 999_999n }),
    ).toThrow(/collateral exposure/);

    const altered = (address: string, coin: number, tokens = 10) =>
      mutate(cbor, (body) => {
        body.collateral_return = {
          AlonzoFormatTxOut: {
            address,
            amount: { coin, multiasset: { ["ab".repeat(28)]: { "01": tokens } } },
            datum_hash: null,
          },
        };
      });

    const recipient = generateEmulatorAccountFromPrivateKey({ lovelace: 1n });

    expect(() =>
      verifyTransactionEffects(altered(recipient.address, 99_000_000), plan, auth),
    ).toThrow(/collateral return/);
    expect(() =>
      verifyTransactionEffects(altered(auth.change.address, 99_000_000, 9), plan, auth),
    ).toThrow(/preserve every native asset/);
    expect(() =>
      verifyTransactionEffects(altered(auth.change.address, 97_000_000), plan, auth),
    ).toThrow(/collateral exposure/);
    expect(() =>
      verifyTransactionEffects(
        mutate(cbor, (body) => {
          body.collateral_return = null;
        }),
        plan,
        auth,
      ),
    ).toThrow(/preserve every native asset/);
  });
});

describe("complete wallet effects", () => {
  it("rejects protected output changes including datum modes and reference scripts", () => {
    const { cbor, plan, auth, script } = effectsFixture();

    for (const changed of [
      { ...plan.outputs[0], value: { ada: 6_000_001n } },
      { ...plan.outputs[0], address: enterprise("ee".repeat(28), "key") },
      { ...plan.outputs[0], datum: constr(43, []) },
    ])
      expect(() =>
        verifyTransactionEffects(
          cbor,
          {
            ...plan,
            outputs: [{ ...plan.outputs[0], ...changed } as (typeof plan.outputs)[number]],
          },
          auth,
        ),
      ).toThrow(/protected output/);

    const changedDatum = mutate(cbor, (body) => {
      const values = body.outputs as Record<string, unknown>[];

      values[0] = {
        AlonzoFormatTxOut: {
          address: auth.planInputs[0]?.address,
          amount: { coin: 6_000_000, multiasset: { [plan.implementation.policy]: { "53": 7 } } },
          datum_hash: "aa".repeat(32),
        },
      };
    });

    expect(() => verifyTransactionEffects(changedDatum, plan, auth)).toThrow(/protected output/);

    const changedScript = mutate(cbor, (body) =>
      withCMLScope((own) => {
        const list = body.outputs as Record<string, unknown>[],
          existing = own(CML.TransactionOutput.from_json(JSON.stringify(list[0]))),
          address = own(existing.address()),
          amount = own(existing.amount()),
          datum = existing.datum();
        const ref = CML.Script.new_plutus_v3(own(CML.PlutusV3Script.from_cbor_hex(script.script)));

        list[0] = JSON.parse(own(CML.TransactionOutput.new(address, amount, datum, ref)).to_json());
      }),
    );

    expect(() => verifyTransactionEffects(changedScript, plan, auth)).toThrow(/protected output/);
  });

  it("rejects changed, missing, extra and wrong-purpose redeemers", () => {
    const { cbor, plan, auth } = effectsFixture();

    for (const [tag, index, data] of [
      [CML.RedeemerTag.Spend, 0n, "00"],
      [CML.RedeemerTag.Spend, 1n, "00"],
      [CML.RedeemerTag.Reward, 1n, "00"],
    ] as const) {
      const changed = mutate(cbor, (_, witnesses) =>
        withCMLScope((own) => {
          const original = witnesses.redeemers();

          if (!original) throw new Error("missing fixture redeemers");

          const flat = own(own(original).to_flat_format()),
            result = own(CML.LegacyRedeemerList.new());

          result.add(
            own(
              CML.LegacyRedeemer.new(
                tag,
                index,
                own(CML.PlutusData.from_cbor_hex(data)),
                own(CML.ExUnits.new(100n, 200n)),
              ),
            ),
          );
          result.add(own(flat.get(1)));
          witnesses.set_redeemers(own(CML.Redeemers.new_arr_legacy_redeemer(result)));
        }),
      );

      expect(() => verifyTransactionEffects(changed, plan, auth)).toThrow(
        /redeemer purpose, index or data/,
      );
    }

    const removed = mutate(cbor, (_, witnesses) =>
      withCMLScope((own) =>
        witnesses.set_redeemers(
          own(CML.Redeemers.new_arr_legacy_redeemer(own(CML.LegacyRedeemerList.new()))),
        ),
      ),
    );

    expect(() => verifyTransactionEffects(removed, plan, auth)).toThrow(
      /unexpected or missing redeemer/,
    );
  });
});

describe("complete wallet effects", () => {
  it("binds approved non-key witness contents, including execution units", () => {
    // Alter budgets without altering the body, then produce a valid signature. Approval must still
    // reject the non-key witness mutation; body signatures alone do not establish this boundary.
    const { cbor, plan, auth, privateKey } = effectsFixture(),
      approval = verifyTransactionEffects(cbor, plan, auth);
    const changed = mutate(cbor, (_, witnesses) =>
      withCMLScope((own) => {
        const original = witnesses.redeemers();

        if (!original) throw new Error("missing fixture redeemers");

        const flat = own(own(original).to_flat_format()),
          result = own(CML.LegacyRedeemerList.new());

        for (let i = 0; i < flat.len(); i++) {
          const item = own(flat.get(i));

          result.add(
            own(
              CML.LegacyRedeemer.new(
                item.tag(),
                item.index(),
                own(item.data()),
                own(CML.ExUnits.new(101n, 201n)),
              ),
            ),
          );
        }

        witnesses.set_redeemers(own(CML.Redeemers.new_arr_legacy_redeemer(result)));
      }),
    );

    expect(() => assertApprovedTransaction(signed(changed, privateKey), approval)).toThrow(
      /non-key witnesses changed/,
    );
    expect(() =>
      assertApprovedTransaction(
        signed(cbor, generateEmulatorAccountFromPrivateKey({ lovelace: 1n }).privateKey),
        approval,
      ),
    ).toThrow(/missing authorized input/);
  });

  it("checks required script identities, whether attached or referenced", () => {
    // Removing the reference program from supplied evidence forces an attached-script requirement.
    // These hash/availability checks intentionally make no claim about program execution success.
    const { cbor, plan, auth, script } = effectsFixture();
    const noReferenceProgram = {
      ...auth,
      allowedReferenceInputs: auth.allowedReferenceInputs.map((input) => ({
        ...input,
        referenceScript: null,
      })),
    };

    expect(() => verifyTransactionEffects(cbor, plan, noReferenceProgram)).toThrow(
      /missing planned script/,
    );

    const attached = mutate(cbor, (_, witnesses) => setWitnessScript(witnesses, script));

    expect(() => verifyTransactionEffects(attached, plan, noReferenceProgram)).not.toThrow();

    const foreign = mutate(cbor, (_, witnesses) =>
      setWitnessScript(witnesses, { type: "PlutusV3", script: "49480100002221200102" }),
    );

    expect(() => verifyTransactionEffects(foreign, plan, auth)).toThrow(/unapproved Plutus script/);

    const datumWitness = mutate(cbor, (_, witnesses) =>
      withCMLScope((own) => {
        const datums = own(CML.PlutusDataList.new());

        datums.add(own(CML.PlutusData.from_cbor_hex("00")));
        witnesses.set_plutus_datums(datums);
      }),
    );

    expect(() => verifyTransactionEffects(datumWitness, plan, auth)).toThrow(
      /unexpected script, datum/,
    );
  });
});

describe("complete wallet effects", () => {
  it("rejects mismatched network evidence, script funding, unresolved inputs and interval mapping", () => {
    const { cbor, plan, auth } = effectsFixture();

    expect(() =>
      verifyTransactionEffects(cbor, plan, { ...auth, networkDomain: "00".repeat(32) }),
    ).toThrow(/plan network/);
    expect(() => verifyTransactionEffects(cbor, plan, { ...auth, planInputs: [] })).toThrow(
      /resolved plan inputs/,
    );
    expect(() =>
      verifyTransactionEffects(cbor, plan, {
        ...auth,
        slotConfig: { ...auth.slotConfig, zeroTime: 1000n },
      }),
    ).toThrow(/POSIX bounds/);

    const source = auth.planInputs[0];

    if (!source) throw new Error("missing source");

    expect(() =>
      verifyTransactionEffects(cbor, plan, { ...auth, allowedFundingInputs: [source] }),
    ).toThrow(/key payment credentials/);
    expect(() =>
      verifyTransactionEffects(cbor, plan, {
        ...auth,
        change: { address: source.address, datum: { kind: "none" } },
      }),
    ).toThrow(/change must return/);
    expect(() =>
      verifyTransactionEffects(cbor, plan, {
        ...auth,
        planInputs: [{ ...source, address: auth.change.address }],
      }),
    ).toThrow(/plan input script identity/);
    expect(() =>
      verifyTransactionEffects(cbor, plan, {
        ...auth,
        allowedCollateralInputs: auth.allowedCollateralInputs.map((input) => ({
          ...input,
          value: { ada: 1n },
        })),
      }),
    ).toThrow(/inconsistent overlapping collateral/);
  });

  it("keeps slot intervals inside unaligned POSIX bounds and permits inward rounding", () => {
    // Millisecond intent cannot be widened to convenient slot boundaries; only contained slots pass.
    const { cbor, plan, auth } = effectsFixture();

    if (!plan.validity) throw new Error("missing fixture interval");

    const unaligned = {
      ...plan,
      validity: { ...plan.validity, lowerPosixMs: 3_001n, upperPosixMs: 8_999n },
    };

    expect(() => verifyTransactionEffects(cbor, unaligned, auth)).toThrow(/POSIX bounds/);

    const inward = mutate(cbor, (body) => {
      body.validity_interval_start = 4;
      body.ttl = 8;
    });

    expect(() =>
      verifyTransactionEffects(inward, unaligned, {
        ...auth,
        validitySlots: { lower: 4n, upper: 8n },
      }),
    ).not.toThrow();

    const unbounded = mutate(cbor, (body) => {
      body.validity_interval_start = null;
      body.ttl = null;
    });

    expect(() =>
      verifyTransactionEffects(unbounded, unaligned, {
        ...auth,
        validitySlots: { lower: null, upper: null },
      }),
    ).toThrow(/POSIX bounds/);
  });
});
