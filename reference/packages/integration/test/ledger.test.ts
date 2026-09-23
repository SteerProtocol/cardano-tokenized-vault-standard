/** Exercises ledger representation edge cases that change projected inputs, output identities or spend attribution. */
import { buildRefundPlan, buildRequestPlan } from "@ctvs/ctvs2";
import { decodeData, enterprise, redeemerFromData, refId } from "@ctvs/protocol";
import { CML, withCMLScope } from "@lucid-evolution/lucid";
import { expect, it } from "vitest";
import { required } from "../../planning/test/fixtures.js";
import { protectedMetadata, readAcceptedTransaction } from "../src/ledger.js";
import { encodePlan, readerFixture, seed } from "./fixtures.js";

type RedeemerFormat = "legacy" | "map";

function transactionWithSpendPointers(indices: bigint[], format: RedeemerFormat): string {
  const f = readerFixture();

  return withCMLScope((own) => {
    const transaction = own(CML.Transaction.from_cbor_hex(f.genesis.cbor));
    const witnesses = own(CML.TransactionWitnessSet.new());
    const data = own(CML.PlutusData.from_cbor_hex("00"));
    const units = own(CML.ExUnits.new(1n, 1n));
    const pointers = [
      { tag: CML.RedeemerTag.Mint, index: 0n },
      ...indices.map((index) => ({ tag: CML.RedeemerTag.Spend, index })),
    ];

    if (format === "legacy") {
      const redeemers = own(CML.LegacyRedeemerList.new());

      for (const { tag, index } of pointers)
        redeemers.add(own(CML.LegacyRedeemer.new(tag, index, data, units)));

      witnesses.set_redeemers(own(CML.Redeemers.new_arr_legacy_redeemer(redeemers)));
    } else {
      const redeemers = own(CML.MapRedeemerKeyToRedeemerVal.new());

      for (const { tag, index } of pointers)
        redeemers.insert(
          own(CML.RedeemerKey.new(tag, index)),
          own(CML.RedeemerVal.new(data, units)),
        );

      witnesses.set_redeemers(own(CML.Redeemers.new_map_redeemer_key_to_redeemer_val(redeemers)));
    }

    return own(CML.Transaction.new(own(transaction.body()), witnesses, true)).to_cbor_hex();
  });
}

it.each(["legacy", "map"] as const)(
  "resolves %s spending pointers without treating mint redeemers as spends",
  (format) => {
    const transaction = readAcceptedTransaction(transactionWithSpendPointers([0n], format));

    expect([...transaction.spends]).toEqual([[refId(seed), "00"]]);
  },
);

it.each([
  ["legacy", 1n],
  ["map", 1n],
  ["legacy", 18_446_744_073_709_551_615n],
  ["map", 18_446_744_073_709_551_615n],
] as const)("rejects %s spending pointer %s beyond the input list", (format, index) => {
  expect(() => readAcceptedTransaction(transactionWithSpendPointers([index], format))).toThrow(
    "spend redeemer index exceeds inputs",
  );
});

it("rejects duplicate legacy spending pointers after flattening", () => {
  expect(() => readAcceptedTransaction(transactionWithSpendPointers([0n, 0n], "legacy"))).toThrow(
    "duplicate spending redeemer",
  );
});

it("applies only collateral inputs and the CIP-40 return index on phase-two failure", () => {
  const f = readerFixture();
  const c = f.reader.context(f.policy);

  if (c.deployment.family !== "ctvs2") throw new Error("wrong family");

  const request = {
    recovery: {
      vaultPolicy: f.policy,
      controller: f.owner.payment.hash,
      refund: { address: f.owner, datum: null },
      deadlinePosixMs: 100n,
    },
    body: {
      termsHash: c.deployment.termsHash,
      kind: "deposit" as const,
      offered: 101n,
      minimumOutput: 100n,
      receiver: { address: f.owner, datum: null },
      storageLovelace: 3_000_000n,
      executionBudget: 1_000_000n,
      settlerFee: 0n,
    },
  };
  const requestCbor = encodePlan(buildRequestPlan({ ...c, deployment: c.deployment, request }));
  const cbor = withCMLScope((own) => {
    const normal = own(CML.Transaction.from_cbor_hex(f.genesis.cbor)),
      body = own(normal.body());
    const created = own(CML.Transaction.from_cbor_hex(requestCbor)),
      createdBody = own(created.body()),
      outputs = own(createdBody.outputs());
    const collateral = own(CML.TransactionInputList.new());

    collateral.add(
      own(CML.TransactionInput.new(own(CML.TransactionHash.from_hex("bb".repeat(32))), 4n)),
    );
    body.set_collateral_inputs(collateral);
    body.set_collateral_return(own(outputs.get(0)));
    body.set_total_collateral(5_000_000n);

    return own(
      CML.Transaction.new(body, own(CML.TransactionWitnessSet.new()), false),
    ).to_cbor_hex();
  });
  const decoded = readAcceptedTransaction(cbor);

  expect(decoded.inputs).toEqual([{ txId: "bb".repeat(32), index: 4n }]);
  expect(decoded.outputs).toHaveLength(1);
  expect(decoded.outputs[0]?.ref.index).toBe(2n);
  expect(decoded.spends.size).toBe(0);
  // Failed ordinary execution leaves State unchanged, but its real collateral return can hold a Request.
  f.reader.rollForward(f.block([cbor]));
  expect(f.reader.request(f.policy, { txId: decoded.id, index: 2n }).data.status).toBe(
    "pending_escrow",
  );
  expect(f.reader.snapshot(f.policy).data.state.sequence).toBe(0n);
});

it("interprets spend redeemer pointers in canonical TxIn order even if CBOR serializes inputs in reverse", () => {
  const f = readerFixture(),
    c = f.reader.context(f.policy);

  if (c.deployment.family !== "ctvs2") throw new Error("wrong family");

  const requestRef = { txId: "11".repeat(32), index: 10n };
  // The recovery source comes from a normal funded request fixture.
  const request = {
    recovery: {
      vaultPolicy: f.policy,
      controller: f.owner.payment.hash,
      refund: { address: f.owner, datum: null },
      deadlinePosixMs: 100n,
    },
    body: {
      termsHash: c.deployment.termsHash,
      kind: "deposit" as const,
      offered: 101n,
      minimumOutput: 100n,
      receiver: { address: f.owner, datum: null },
      storageLovelace: 3_000_000n,
      executionBudget: 1_000_000n,
      settlerFee: 0n,
    },
  };
  const creation = buildRequestPlan({ ...c, deployment: c.deployment, request });
  const out = required(creation.outputs[0]);
  const plan = buildRefundPlan({
    deployment: c.deployment,
    source: {
      ref: requestRef,
      address: out.address,
      datum: required(out.datum),
      value: out.value,
      datumMode: "inline",
      referenceScript: null,
    },
    mode: "cancel",
    validity: { lowerPosixMs: 1n, upperPosixMs: 50n },
  });

  plan.inputs.push({ ref: { ...requestRef, index: 2n }, role: "genesis_seed", redeemer: null });

  const original = encodePlan(plan);
  // Change only serialized input order; redeemer identity must continue to follow canonical ledger order.
  const reversed = withCMLScope((own) => {
    const tx = own(CML.Transaction.from_cbor_hex(original)),
      old = own(tx.body()),
      list = own(old.inputs()),
      inputs = own(CML.TransactionInputList.new());

    for (let i = list.len() - 1; i >= 0; i--) inputs.add(own(list.get(i)));

    const body = own(CML.TransactionBody.new(inputs, own(old.outputs()), old.fee()));

    return own(CML.Transaction.new(body, own(tx.witness_set()), true)).to_cbor_hex();
  });
  const tx = readAcceptedTransaction(reversed);
  const redeemer = tx.spends.get(refId(requestRef));

  expect(redeemer).toBeDefined();
  expect(redeemerFromData("request", decodeData(required(redeemer))).operation).toBe("cancel");
});

it("preserves strict Cardano output metadata and distinguishes unsupported recovery from missing origin", () => {
  const f = readerFixture();
  const source = required(f.genesis.tx.outputs[1]);

  expect(() => protectedMetadata(source, f.policy, 1)).toThrow("enterprise");
  expect(() =>
    protectedMetadata({ ...source, datum: null, datumHash: "11".repeat(32) }, f.policy, 0),
  ).toThrow("inline");
  expect(() => protectedMetadata({ ...source, scriptRef: f.reviewed.config }, f.policy, 0)).toThrow(
    "reference script",
  );

  const plan = {
    ...f.plan,
    inputs: [],
    mint: [],
    outputs: [{ ...required(f.plan.outputs[1]), datum: 42n, value: { ada: 3_000_000n } }],
  };
  const accepted = f.append(plan),
    ref = { txId: accepted.tx.id, index: 0n };

  expect(f.reader.candidate(f.policy, ref).data).toMatchObject({
    classification: "unsupported_recovery",
    recovery: { status: "unsupported" },
    vaultLiability: false,
  });
  expect(() => f.reader.candidate(f.policy, { ...ref, index: 99n })).toThrow("no candidate");
  expect(() => protectedMetadata({ ...source, address: "bad" }, f.policy, 0)).toThrow();
  expect(enterprise(f.policy).payment.type).toBe("script");
});
