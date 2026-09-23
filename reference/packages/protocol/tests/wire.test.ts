/** WIRE-2 conformance tests cover commitments, exact arities, role separation and protected indices. */
import { describe, expect, it } from "vitest";
import type {
  CredentialType,
  DataConstr,
  Destination,
  Operation,
  PlutusData,
  RequestBody,
  Role,
  Terms,
} from "../src/index.js";
import {
  acknowledgeRedeemer,
  assetData,
  assetFromData,
  assetId,
  batchRedeemer,
  bytes,
  claimData,
  claimFromData,
  collectFeesRedeemer,
  configData,
  configFromData,
  constr,
  credentialData,
  deliverRedeemer,
  destinationData,
  destinationFromData,
  directRedeemer,
  encodeData,
  enterprise,
  envelope,
  equalData,
  isConstr,
  mintRedeemer,
  outRefData,
  outRefFromData,
  Q_MAX,
  recoveryData,
  recoveryFromData,
  redeemerFromData,
  refId,
  refundRedeemer,
  requestBodyData,
  requestBodyFromData,
  requestData,
  requestFromData,
  requestRecoveryFromData,
  setPauseRedeemer,
  sortedReferences,
  stateData,
  stateFromData,
  termsData,
  termsFromData,
  termsHash,
  topUpRedeemer,
} from "../src/index.js";
import { fields, readBytes, sized } from "../src/wire/primitives.js";
import {
  claim,
  config,
  destination,
  key,
  policy,
  request,
  requestRef,
  state,
  stateRef,
  terms,
} from "./fixtures/example.js";

function replace(data: DataConstr, index: number, value: PlutusData): DataConstr {
  const result = structuredClone(data);

  result.fields[index] = value;

  return result;
}

function action(data: DataConstr): DataConstr {
  const result = data.fields[2];

  if (result === undefined || !isConstr(result)) throw new Error("expected action");

  return result;
}

const direct = {
  receiver: destination,
  amount: 100n,
  bound: 1n,
  stateOutput: 0n,
  receiverOutput: 1n,
};
const batch = {
  stateOutput: 0n,
  entries: [{ requestRef, claimOutput: 1n, claimTopup: 0n }],
  rewardKey: key,
  rewardOutput: 2n,
};

describe("WIRE-2 typed datum codec", () => {
  it("roundtrips all datum roles and the separate recovery and economic projections", () => {
    expect(termsFromData(termsData(terms))).toEqual(terms);
    expect(stateFromData(stateData(state))).toEqual(state);
    expect(configFromData(configData(config))).toEqual(config);
    expect(requestFromData(requestData(request))).toEqual(request);
    expect(claimFromData(claimData(claim))).toEqual(claim);
    expect(recoveryFromData(recoveryData(request.recovery))).toEqual(request.recovery);
    expect(requestBodyFromData(requestBodyData(request.body))).toEqual(request.body);
    expect(requestRecoveryFromData(requestData(request))).toEqual({
      recovery: request.recovery,
      economicBody: requestBodyData(request.body),
    });
  });
  it("retains the builtin-certified domain-separated terms hash", () => {
    expect(termsHash(terms)).toBe(
      "3e786871c31d0ba1684920693cbb3ae53e42eca96d272280bf732e44b8844220",
    );
    expect(termsHash({ ...terms, virtualShares: 2n })).not.toBe(termsHash(terms));
    expect(() => configData({ ...config, terms: { ...terms, virtualShares: 2n } })).toThrow(
      /hash mismatch/,
    );
    expect(() => configFromData(replace(configData(config), 4, bytes("00".repeat(32))))).toThrow(
      /hash mismatch/,
    );
  });
  it("roundtrips present options, credential families and bounded inline datum", () => {
    const target: Destination = {
      address: { payment: { type: "script", hash: policy }, stake: { type: "key", hash: key } },
      datum: {
        map: [
          [2n, constr(0)],
          [1n, bytes("ab")],
        ],
      },
    };

    expect(destinationFromData(destinationData(target))).toEqual(target);

    const scriptStake: Destination = {
      address: { payment: { type: "key", hash: key }, stake: { type: "script", hash: policy } },
      datum: [],
    };

    expect(destinationFromData(destinationData(scriptStake))).toEqual(scriptStake);
    expect(enterprise(policy)).toEqual({ payment: { type: "script", hash: policy }, stake: null });

    const rules: Terms = {
      ...terms,
      underlying: "ada",
      maxBacking: Q_MAX,
      feeDestination: target,
      pauseKey: null,
      settlers: ["00".repeat(28), key],
      descriptorHash: "ff".repeat(32),
    };

    expect(termsFromData(termsData(rules))).toEqual(rules);
    expect(claimFromData(claimData({ ...claim, asset: "ada" })).asset).toBe("ada");
    expect(requestBodyFromData(requestBodyData({ ...request.body, kind: "redeem" })).kind).toBe(
      "redeem",
    );
  });
});

describe("WIRE-2 typed datum codec", () => {
  it("rejects trailing constructor fields at every outer datum boundary", () => {
    const cases: [DataConstr, (data: PlutusData) => unknown][] = [
      [termsData(terms), termsFromData],
      [stateData(state), stateFromData],
      [configData(config), configFromData],
      [requestData(request), requestFromData],
      [claimData(claim), claimFromData],
      [recoveryData(request.recovery), recoveryFromData],
      [requestBodyData(request.body), requestBodyFromData],
    ];

    for (const [data, decode] of cases) {
      expect(() => decode(constr(data.constr, [...data.fields, 0n]))).toThrow(/arity/);
      expect(() => decode(constr(data.constr, data.fields.slice(1)))).toThrow(/arity/);
      expect(() => decode(0n)).toThrow(/arity/);
    }
  });
  it("rejects magic, version, wrong role and recursive option or scalar shapes", () => {
    for (const data of [
      replace(stateData(state), 0, bytes("00000000")),
      replace(stateData(state), 1, 3n),
      replace(stateData(state), 1, bytes("02")),
    ])
      expect(() => stateFromData(data)).toThrow(/magic\/wire/);

    expect(() => stateFromData(requestData(request))).toThrow(/arity/);
    expect(() => termsFromData(replace(termsData(terms), 4, constr(1, [0n])))).toThrow(/arity/);
    expect(() => termsFromData(replace(termsData(terms), 8, constr(0, [1n])))).toThrow(/byte/);
    expect(() => termsFromData(replace(termsData(terms), 12, constr(0, [bytes("00")])))).toThrow(
      /byte/,
    );
    expect(() => stateFromData(replace(stateData(state), 5, constr(0)))).toThrow(/bigint/);
    expect(() =>
      recoveryFromData(replace(recoveryData(request.recovery), 1, constr(1, [bytes(key)]))),
    ).toThrow(/arity/);
  });
  it("enforces settler key cardinality, ordering, duplicates and decoder list shape", () => {
    for (const settlers of [
      [],
      Array.from({ length: 17 }, () => key),
      [key, key],
      [key, "00".repeat(28)],
    ])
      expect(() => termsData({ ...terms, settlers })).toThrow(/settler/);

    expect(() => termsFromData(replace(termsData(terms), 9, constr(1, [0n])))).toThrow(/list/);
    expect(() => termsFromData(replace(termsData(terms), 9, constr(0, [0n])))).toThrow(/arity/);
    expect(() =>
      termsFromData(
        replace(termsData(terms), 9, constr(1, [[bytes(key), bytes("00".repeat(28))]])),
      ),
    ).toThrow(/sorted/);
  });
});

describe("WIRE-2 typed datum codec", () => {
  it("limits quantities, aggregate reserves, fees and operation modes", () => {
    for (const patch of [
      { profile: 1n },
      { virtualShares: 0n },
      { entryBps: 10000n },
      { exitBps: -1n },
      { executionModes: 0n },
      { executionModes: 16n },
      { maxBatch: 0n },
      { maxBatch: 17n },
    ])
      expect(() => termsData({ ...terms, ...patch })).toThrow();

    for (const patch of [{ sequence: Q_MAX + 1n }, { storageLovelace: 0n }, { pauseFlags: 4n }])
      expect(() => stateData({ ...state, ...patch })).toThrow();

    expect(() => configData({ ...config, storageLovelace: 0n })).toThrow();
    expect(() => recoveryData({ ...request.recovery, deadlinePosixMs: 0n })).toThrow(/deadline/);

    const invalidBody: Partial<RequestBody>[] = [
      { settlerFee: request.body.executionBudget + 1n },
      { storageLovelace: Q_MAX, executionBudget: 1n },
      { offered: 0n },
      { minimumOutput: 0n },
      { executionBudget: -1n },
    ];

    for (const patch of invalidBody)
      expect(() => requestBodyData({ ...request.body, ...patch })).toThrow();

    expect(() =>
      claimData({ ...claim, asset: "ada", economicQuantity: Q_MAX, carriedLovelace: 1n }),
    ).toThrow(/aggregate/);
    expect(() => claimData({ ...claim, economicQuantity: 0n })).toThrow();
    expect(() => claimData({ ...claim, carriedLovelace: 0n })).toThrow();
  });
  it("keeps cancellation recovery available for unsupported and oversized economic bodies", () => {
    for (const economicBody of [constr(128, [1n]), bytes("00".repeat(5000)), 0n]) {
      const raw = replace(requestData(request), 3, economicBody);

      expect(requestRecoveryFromData(raw)).toEqual({ recovery: request.recovery, economicBody });
      expect(() => requestFromData(raw)).toThrow();
    }

    expect(() => requestBodyFromData(replace(requestBodyData(request.body), 1, constr(2)))).toThrow(
      /kind/,
    );
    expect(() => requestBodyFromData(replace(requestBodyData(request.body), 1, 0n))).toThrow(
      /kind/,
    );
    expect(() =>
      requestBodyFromData(replace(requestBodyData(request.body), 1, constr(0, [0n]))),
    ).toThrow(/arity/);
  });
});

describe("ledger leaf encodings", () => {
  it("preserves asset and output-reference identities without textual case drift", () => {
    expect(assetFromData(assetData("ada"))).toBe("ada");
    expect(assetId("ada")).toBe("ada");

    const native = { policy: "AB".repeat(28), name: "CD" };

    expect(assetId(native)).toBe(`${"ab".repeat(28)}.cd`);
    expect(assetFromData(assetData(native))).toEqual({ policy: "ab".repeat(28), name: "cd" });
    expect(outRefFromData(outRefData(stateRef))).toEqual(stateRef);
    expect(refId({ txId: "AB".repeat(32), index: 65535n })).toBe(`${"ab".repeat(32)}#65535`);
    expect(() => outRefData({ ...stateRef, index: 65536n })).toThrow();
    expect(() => assetData({ policy, name: "00".repeat(33) })).toThrow(/32/);
    expect(() => assetFromData(constr(0, [0n]))).toThrow(/arity/);
    expect(() => assetFromData(constr(1, [bytes(policy), 0n]))).toThrow(/byte/);
  });
  it("rejects pointer staking, wrong credentials and excessive opaque data", () => {
    const pointer = constr(0, [constr(0, [bytes(key)]), constr(0, [constr(1, [0n, 0n, 0n])])]);

    expect(() => destinationFromData(constr(0, [pointer, constr(1)]))).toThrow(/arity/);

    const badCredential = constr(0, [constr(2, [bytes(key)]), constr(1)]);

    expect(() => destinationFromData(constr(0, [badCredential, constr(1)]))).toThrow(/credential/);
    expect(() => destinationData({ ...destination, datum: constr(128) })).toThrow();
    expect(() => credentialData({ type: "pointer" as CredentialType, hash: key })).toThrow(
      /credential/,
    );
    expect(() => readBytes(0n)).toThrow(/byte/);
    expect(readBytes(bytes("ab"))).toBe("ab");
    expect(() => sized(bytes("00"), 0, "test")).toThrow(/byte bound/);
    expect(() => fields(constr(0), 1, 0, "tag")).toThrow();
  });
  it("sorts references by raw txid and numeric index and rejects duplicates", () => {
    const refs = [
      { txId: requestRef.txId, index: 0n },
      { txId: stateRef.txId, index: 10n },
      { txId: stateRef.txId, index: 2n },
    ];

    expect(sortedReferences(refs)).toEqual([refs[2], refs[1], refs[0]]);
    expect(refs[0]).toEqual(requestRef);
    expect(() => sortedReferences([])).toThrow(/count/);
    expect(() => sortedReferences(Array.from({ length: 17 }, () => stateRef))).toThrow(/count/);
    expect(() =>
      sortedReferences([stateRef, { ...stateRef, txId: stateRef.txId.toUpperCase() }]),
    ).toThrow(/duplicate/);
  });
});

describe("role-specific action envelopes", () => {
  it.each<Operation>(["deposit", "mint", "withdraw", "redeem"])(
    "roundtrips direct %s",
    (operation) => {
      expect(redeemerFromData("state", directRedeemer(operation, direct))).toEqual({
        role: "state",
        operation,
        ...direct,
      });
    },
  );
  it("roundtrips every maintenance, request, mint and claim action", () => {
    expect(redeemerFromData("state", batchRedeemer(batch))).toEqual({
      role: "state",
      operation: "batch",
      ...batch,
    });
    expect(
      redeemerFromData("state", batchRedeemer({ ...batch, rewardOutput: null })),
    ).toMatchObject({ rewardOutput: null });
    expect(redeemerFromData("state", collectFeesRedeemer(0n, 1n))).toEqual({
      role: "state",
      operation: "collect_fees",
      stateOutput: 0n,
      feeOutput: 1n,
    });
    expect(redeemerFromData("state", topUpRedeemer(1n, 0n))).toEqual({
      role: "state",
      operation: "top_up_reserve",
      stateOutput: 0n,
      amount: 1n,
    });
    expect(redeemerFromData("state", setPauseRedeemer(3n, 0n))).toEqual({
      role: "state",
      operation: "set_pause",
      stateOutput: 0n,
      flags: 3n,
    });
    expect(redeemerFromData("request", acknowledgeRedeemer(stateRef))).toEqual({
      role: "request",
      operation: "acknowledge",
      stateRef,
    });

    for (const operation of ["cancel", "expiry"] as const)
      expect(redeemerFromData("request", refundRedeemer(operation, 1n))).toEqual({
        role: "request",
        operation,
        refundOutput: 1n,
      });

    expect(
      redeemerFromData("mint", mintRedeemer({ genesis: true, configOutput: 0n, stateOutput: 1n })),
    ).toEqual({
      role: "mint",
      operation: "initialize",
      genesis: true,
      configOutput: 0n,
      stateOutput: 1n,
    });
    expect(redeemerFromData("mint", mintRedeemer({ genesis: false, stateRef }))).toEqual({
      role: "mint",
      operation: "supply_update",
      genesis: false,
      stateRef,
    });

    const entries = [{ claimRef: requestRef, receiverOutput: 0n }];

    expect(redeemerFromData("claim", deliverRedeemer(entries))).toEqual({
      role: "claim",
      operation: "deliver",
      entries,
    });
  });
});

describe("role-specific action envelopes", () => {
  it("rejects unsupported roles and tags and nonconstructor action payloads", () => {
    for (const role of ["state", "request", "mint"] as const) {
      expect(() => redeemerFromData(role, envelope(role, constr(99)))).toThrow(/unsupported/);
      expect(() => redeemerFromData(role, envelope(role, 0n))).toThrow(/unsupported/);
    }

    expect(() => redeemerFromData("claim", envelope("claim", constr(1)))).toThrow(/arity/);
    expect(() => redeemerFromData("state", refundRedeemer("cancel", 0n))).toThrow(/arity/);
    expect(() => envelope("unknown" as Role, constr(0))).toThrow(/role/);
    expect(() => redeemerFromData("unknown" as Role, constr(0))).toThrow(/role/);
    expect(() => directRedeemer("manage" as Operation, direct)).toThrow(/action/);
    expect(() => refundRedeemer("late" as "expiry", 0n)).toThrow(/mode/);
    expect(() => requestBodyData({ ...request.body, kind: "mint" as "deposit" })).toThrow(/kind/);
  });
  it("rejects wrong arity, list type and invalid nested indices", () => {
    const raw = directRedeemer("deposit", direct);

    expect(() => redeemerFromData("state", constr(0, [...raw.fields, 0n]))).toThrow(/arity/);
    expect(() =>
      redeemerFromData("state", replace(raw, 2, constr(0, [...action(raw).fields, 0n]))),
    ).toThrow(/arity/);
    expect(() =>
      redeemerFromData("state", envelope("state", constr(4, [0n, 0n, bytes(key), constr(1)]))),
    ).toThrow(/list/);
    expect(() => redeemerFromData("claim", envelope("claim", constr(0, [0n])))).toThrow(/list/);
    expect(() => redeemerFromData("request", envelope("request", constr(1, [65536n])))).toThrow();
    expect(() =>
      redeemerFromData("mint", envelope("mint", constr(1, [constr(0, [bytes("00"), 0n])]))),
    ).toThrow(/byte/);
  });
  it("enforces injective outputs in every action with protected output indices", () => {
    expect(() => directRedeemer("deposit", { ...direct, receiverOutput: 0n })).toThrow(
      /overlapping/,
    );
    expect(() => batchRedeemer({ ...batch, rewardOutput: 1n })).toThrow(/overlapping/);
    expect(() =>
      batchRedeemer({ ...batch, entries: [{ requestRef, claimOutput: 0n, claimTopup: 0n }] }),
    ).toThrow(/overlapping/);
    expect(() => mintRedeemer({ genesis: true, stateOutput: 0n, configOutput: 0n })).toThrow(
      /overlapping/,
    );
    expect(() => collectFeesRedeemer(0n, 0n)).toThrow(/overlapping/);
    expect(() =>
      deliverRedeemer([
        { claimRef: stateRef, receiverOutput: 0n },
        { claimRef: requestRef, receiverOutput: 0n },
      ]),
    ).toThrow(/overlapping/);
    expect(() => setPauseRedeemer(4n, 0n)).toThrow();
    expect(() => topUpRedeemer(0n, 0n)).toThrow();
  });
  it("normalizes builder input order while rejecting unsorted semantic action Data", () => {
    const entries = [
      { requestRef, claimOutput: 1n, claimTopup: 0n },
      { requestRef: stateRef, claimOutput: 2n, claimTopup: 0n },
    ];
    const raw = batchRedeemer({ ...batch, entries, rewardOutput: null });
    const decoded = redeemerFromData("state", raw);

    expect(decoded.operation).toBe("batch");

    if (decoded.operation === "batch") expect(decoded.entries[0]?.requestRef).toEqual(stateRef);

    const a = action(raw);
    const list = a.fields[1];

    if (!Array.isArray(list)) throw new Error("expected entries");

    expect(() =>
      redeemerFromData("state", replace(raw, 2, replace(a, 1, [...list].reverse()))),
    ).toThrow(/order/);

    const delivery = deliverRedeemer([
      { claimRef: requestRef, receiverOutput: 0n },
      { claimRef: stateRef, receiverOutput: 1n },
    ]);
    const d = action(delivery);
    const dl = d.fields[0];

    if (!Array.isArray(dl)) throw new Error("expected delivery list");

    expect(() =>
      redeemerFromData("claim", replace(delivery, 2, replace(d, 0, [...dl].reverse()))),
    ).toThrow(/order/);
    expect(equalData(raw, structuredClone(raw))).toBe(true);
    expect(encodeData(raw).length).toBeGreaterThan(0);
  });
});
