/** Mocks WASM results to isolate signed-budget and purpose-coverage checks; integrations execute the scripts. */
import { CML, type EvaluationInput, PROTOCOL_PARAMETERS_DEFAULT } from "@lucid-evolution/lucid";
import { eval_phase_two_raw } from "@lucid-evolution/uplc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cborHash, RecordedEvaluator } from "./evaluator.js";

vi.mock("@lucid-evolution/uplc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@lucid-evolution/uplc")>()),
  eval_phase_two_raw: vi.fn(),
}));

interface Declared {
  tag: CML.RedeemerTag;
  index: bigint;
  memory: bigint;
  steps: bigint;
}
type Representation = "legacy" | "map";

const required: Declared = { tag: CML.RedeemerTag.Spend, index: 0n, memory: 1_000n, steps: 5_000n };
const allocated: { free(): void }[] = [];

function own<T extends { free(): void }>(value: T): T {
  allocated.push(value);

  return value;
}

function encodedResult(item: Declared): Uint8Array {
  return own(
    CML.LegacyRedeemer.new(
      item.tag,
      item.index,
      own(CML.PlutusData.from_cbor_hex("00")),
      own(CML.ExUnits.new(item.memory, item.steps)),
    ),
  ).to_cbor_bytes();
}

function transaction(items: Declared[], representation: Representation = "legacy"): string {
  const witnesses = own(CML.TransactionWitnessSet.new());

  if (items.length > 0) {
    if (representation === "legacy") {
      const list = own(CML.LegacyRedeemerList.new());

      for (const item of items)
        list.add(own(CML.LegacyRedeemer.from_cbor_bytes(encodedResult(item))));

      witnesses.set_redeemers(own(CML.Redeemers.new_arr_legacy_redeemer(list)));
    } else {
      const map = own(CML.MapRedeemerKeyToRedeemerVal.new());

      for (const item of items)
        map.insert(
          own(CML.RedeemerKey.new(item.tag, item.index)),
          own(
            CML.RedeemerVal.new(
              own(CML.PlutusData.from_cbor_hex("00")),
              own(CML.ExUnits.new(item.memory, item.steps)),
            ),
          ),
        );

      witnesses.set_redeemers(own(CML.Redeemers.new_map_redeemer_key_to_redeemer_val(map)));
    }
  }

  const body = own(
    CML.TransactionBody.new(
      own(CML.TransactionInputList.new()),
      own(CML.TransactionOutputList.new()),
      200_000n,
    ),
  );

  return own(CML.Transaction.new(body, witnesses, true)).to_cbor_hex();
}

function input(tx: string): EvaluationInput {
  return {
    tx,
    additionalUTxOs: [],
    context: {
      network: "Custom",
      slotConfig: { zeroTime: 0, zeroSlot: 0, slotLength: 1_000 },
      costModels: own(CML.CostModels.from_cbor_hex("a0")),
      protocolParameters: {
        ...PROTOCOL_PARAMETERS_DEFAULT,
        maxTxExMem: 10_000n,
        maxTxExSteps: 100_000n,
      },
    },
  };
}

async function constructed(items: Declared[] = [required]): Promise<RecordedEvaluator> {
  vi.mocked(eval_phase_two_raw).mockReturnValue(items.map(encodedResult));

  const evaluator = new RecordedEvaluator();

  evaluator.stage = "regression";
  // Construction may contain zero placeholder budgets; only final declarations are binding.
  await evaluator.evaluate(
    input(transaction(items.map((item) => ({ ...item, memory: 0n, steps: 0n })))),
  );

  return evaluator;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  for (const value of allocated.reverse()) value.free();

  allocated.length = 0;
});

describe("signed transaction execution budgets", () => {
  it.each(["legacy", "map"] as const)(
    "evaluates final %s CBOR and accepts sufficient signed budgets",
    async (representation) => {
      const evaluator = await constructed();
      const finalCbor = transaction(
        [{ ...required, memory: 1_100n, steps: 5_500n }],
        representation,
      );

      await evaluator.verifySigned(finalCbor);

      const call = vi.mocked(eval_phase_two_raw).mock.lastCall;

      expect(call).toBeDefined();
      expect(Buffer.from(call?.[0] ?? []).toString("hex")).toBe(finalCbor);
      expect(evaluator.records.at(-1)).toMatchObject({
        phase: "signed",
        accepted: true,
        cborSha256: cborHash(finalCbor),
      });
      expect(evaluator.records[0]).toMatchObject({ phase: "construction", accepted: true });
      expect(evaluator.phase).toBe("construction");
    },
  );

  it.each(["memory", "steps"] as const)(
    "rejects understated signed %s even when global limits suffice",
    async (dimension) => {
      const evaluator = await constructed();

      await expect(
        evaluator.verifySigned(
          transaction([{ ...required, [dimension]: required[dimension] - 1n }]),
        ),
      ).rejects.toThrow(/Insufficient signed/);
      expect(evaluator.records.at(-1)).toMatchObject({ phase: "signed", accepted: false });
      expect(evaluator.phase).toBe("construction");
    },
  );

  it.each(["memory", "steps"] as const)(
    "rejects aggregate declared %s beyond the transaction limit",
    async (dimension) => {
      const pair = [required, { ...required, tag: CML.RedeemerTag.Mint }];
      const evaluator = await constructed(pair);
      const budgets = pair.map((item) => ({
        ...item,
        [dimension]: dimension === "memory" ? 6_000n : 60_000n,
      }));

      await expect(evaluator.verifySigned(transaction(budgets, "map"))).rejects.toThrow(
        /Signed aggregate/,
      );
    },
  );
});

describe("signed transaction execution budgets", () => {
  it.each([
    ["missing", []],
    ["extra", [required, { ...required, tag: CML.RedeemerTag.Mint }]],
    ["wrong purpose", [{ ...required, tag: CML.RedeemerTag.Mint }]],
    ["wrong index", [{ ...required, index: 1n }]],
  ] satisfies [string, Declared[]][])(
    "rejects %s signed redeemer coverage",
    async (_, declarations) => {
      const evaluator = await constructed();

      await expect(evaluator.verifySigned(transaction(declarations))).rejects.toThrow(
        /Signed redeemer coverage changed/,
      );
    },
  );

  it("rejects duplicate signed purpose/index entries", async () => {
    const evaluator = await constructed();

    await expect(evaluator.verifySigned(transaction([required, required]))).rejects.toThrow(
      /Duplicate signed redeemer/,
    );
  });

  it("rejects signed evaluator results that omit a declared purpose", async () => {
    const evaluator = await constructed();

    vi.mocked(eval_phase_two_raw).mockReturnValueOnce([]);
    await expect(evaluator.verifySigned(transaction([required]))).rejects.toThrow(
      /Signed evaluation did not cover/,
    );
  });

  it("rejects duplicate evaluated purpose/index entries", async () => {
    const evaluator = await constructed();

    vi.mocked(eval_phase_two_raw).mockReturnValueOnce([
      encodedResult(required),
      encodedResult(required),
    ]);
    await expect(evaluator.verifySigned(transaction([required]))).rejects.toThrow(
      /Duplicate evaluated redeemer/,
    );
  });
});

describe("signed transaction execution budgets", () => {
  it("fails closed when a signed script transaction has no construction context", async () => {
    const evaluator = new RecordedEvaluator();

    await expect(evaluator.verifySigned(transaction([required]))).rejects.toThrow(
      /Missing construction context/,
    );
    expect(eval_phase_two_raw).not.toHaveBeenCalled();
    expect(evaluator.records.at(-1)).toMatchObject({ phase: "signed", accepted: false });
  });

  it("allows a key-only transaction with no construction evaluation", async () => {
    const evaluator = new RecordedEvaluator();

    await expect(evaluator.verifySigned(transaction([]))).resolves.toBeUndefined();
    expect(eval_phase_two_raw).not.toHaveBeenCalled();
  });

  it("does not reuse purpose coverage after a failed construction attempt", async () => {
    const evaluator = await constructed();

    vi.mocked(eval_phase_two_raw).mockImplementationOnce(() => {
      throw new Error("construction failed");
    });
    await expect(evaluator.evaluate(input(transaction([required])))).rejects.toThrow(
      "construction failed",
    );
    await expect(evaluator.verifySigned(transaction([required]))).rejects.toThrow(
      /Missing successful construction evaluation/,
    );
  });
});
