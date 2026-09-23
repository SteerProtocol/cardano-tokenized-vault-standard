/** Uses deterministic preparation outcomes to test grouping/retry policy independently of ledger evaluation. */
import type { OutRef } from "@ctvs/protocol";
import { describe, expect, it } from "vitest";
import {
  ResourceLimitError,
  SelectionStateChangedError,
  selectNextBatch,
  selectNextDelivery,
} from "../src/selection.js";

const ref = (index: number): OutRef => ({ txId: "ab".repeat(32), index: BigInt(index) });

const groups = (count: number) => Array.from({ length: count }, (_, i) => ({ items: [ref(i)] }));

const options = (count: number) => ({
  groups: groups(count),
  ref: (item: OutRef) => item,
  validateAll: () => {},
  readSnapshot: async () => ({ stateRef: ref(99), maxBatch: 16n, context: null }),
});

/** Deliberately simulate a classified evaluator result; this helper performs no ledger measurement. */
const limited = () => {
  throw new ResourceLimitError("memory", "Measured limit");
};

describe("measured transaction selection", () => {
  it("tries descending prefixes without assuming monotonic mixed-batch feasibility", async () => {
    // Success at three items between failures at two/four makes binary-search assumptions visible.
    const attempted: number[] = [];
    const selected = await selectNextBatch({
      ...options(4),
      prepare: async (items) => {
        attempted.push(items.length);

        if (items.length === 4 || items.length === 2) return limited();

        return items.length;
      },
    });

    expect(attempted).toEqual([4, 3]);
    expect(selected.prepared).toBe(3);
    expect(selected.includedRefs).toEqual([ref(0), ref(1), ref(2)]);
    expect(selected.excluded).toEqual([
      {
        ref: ref(3),
        reason: "needs-separate-group",
        tested: false,
        detail: expect.stringContaining("fresh State"),
      },
    ]);
  });

  it("obeys immutable maxBatch and the Claim structural cap without inventing measured caps", async () => {
    const batch = await selectNextBatch({
      ...options(5),
      readSnapshot: async () => ({ stateRef: ref(99), maxBatch: 2n, context: null }),
      prepare: async (items) => items.length,
    });

    expect(batch.prepared).toBe(2);
    expect(batch.excluded).toHaveLength(3);

    const delivery = await selectNextDelivery({
      ...options(17),
      prepare: async (items) => items.length,
    });

    expect(delivery.prepared).toBe(16);
    expect(delivery.excluded).toHaveLength(1);
  });

  it("preflights every selected intent and never hides an invalid remainder", async () => {
    // The seventeenth item lies outside the structural cap but remains part of the user's intent.
    let prepared = false;

    await expect(
      selectNextBatch({
        ...options(17),
        validateAll: (items) => {
          expect(items).toHaveLength(17);

          throw new Error("request minimum violated at input 17");
        },
        prepare: async () => {
          prepared = true;
        },
      }),
    ).rejects.toThrow("request minimum violated");
    expect(prepared).toBe(false);
  });

  it.each(["unauthorized settler", "backing exceeds cap", "missing input", "minimum ADA changed"])(
    "does not interpret %s as a resource failure",
    async (message) => {
      let attempts = 0;

      await expect(
        selectNextBatch({
          ...options(3),
          prepare: async () => {
            attempts++;

            throw new Error(message);
          },
        }),
      ).rejects.toThrow(message);
      expect(attempts).toBe(1);
    },
  );

  it("reports a measured singleton failure and can select later intents without dropping the first", async () => {
    const selected = await selectNextDelivery({
      ...options(3),
      prepare: async (items) => {
        if (items.some((item) => item.index === 0n)) return limited();

        return items.length;
      },
    });

    expect(selected.prepared).toBe(2);
    expect(selected.excluded).toEqual([
      { ref: ref(0), reason: "individual-resource-limit", tested: true, detail: "Measured limit" },
    ]);
    expect(selected.attempts.map((attempt) => attempt.refs.length)).toEqual([3, 2, 1, 2]);
  });
});

describe("measured transaction selection", () => {
  it("never splits a declared dependency group or mislabels it individually infeasible", async () => {
    // The pair fails atomically; neither member is tested alone or reported as individually infeasible.
    const attempted: bigint[][] = [];
    const selected = await selectNextBatch({
      ...options(0),
      groups: [{ items: [ref(0), ref(1)] }, { items: [ref(2)] }],
      prepare: async (items) => {
        attempted.push(items.map((item) => item.index));

        if (items.some((item) => item.index === 0n)) return limited();

        return items.length;
      },
    });

    expect(attempted).toEqual([[0n, 1n, 2n], [0n, 1n], [2n]]);
    expect(selected.excluded.map((item) => item.reason)).toEqual([
      "atomic-group-resource-limit",
      "atomic-group-resource-limit",
    ]);
  });

  it("reports an indivisible structural overflow separately from a measured resource limit", async () => {
    const selected = await selectNextDelivery({
      ...options(0),
      groups: [{ items: groups(17).flatMap((group) => group.items) }, { items: [ref(18)] }],
      prepare: async (items) => items.length,
    });

    expect(selected.prepared).toBe(1);
    expect(selected.excluded).toHaveLength(17);
    expect(
      selected.excluded.every(
        (item) => item.reason === "atomic-group-exceeds-structural-limit" && !item.tested,
      ),
    ).toBe(true);
  });
});

describe("measured transaction selection", () => {
  it("rejects State changes during selection and captures a fresh snapshot for the next batch", async () => {
    // Change the observed State during preparation, then demonstrate a separate call uses the new one.
    let index = 90;

    await expect(
      selectNextBatch({
        ...options(1),
        readSnapshot: async () => ({ stateRef: ref(index), maxBatch: 16n, context: index }),
        prepare: async () => {
          index++;

          return index;
        },
      }),
    ).rejects.toBeInstanceOf(SelectionStateChangedError);

    const selected = await selectNextBatch({
      ...options(1),
      readSnapshot: async () => ({ stateRef: ref(index), maxBatch: 16n, context: index }),
      prepare: async (_, snapshot) => snapshot.context,
    });

    expect(selected.pricingBasis).toEqual(ref(91));
    expect(selected.prepared).toBe(91);
  });

  it("reports all infeasible inputs and does not manufacture a transaction", async () => {
    const selected = await selectNextDelivery({ ...options(2), prepare: async () => limited() });

    expect(selected.prepared).toBeNull();
    expect(selected.included).toEqual([]);
    expect(selected.excluded).toHaveLength(2);
    expect(selected.excluded.every((item) => item.reason === "individual-resource-limit")).toBe(
      true,
    );
  });

  it("validates reference identity, group shape and immutable bounds before preparation", async () => {
    await expect(
      selectNextDelivery({
        ...options(0),
        groups: [{ items: [ref(1), ref(1)] }],
        prepare: async () => 0,
      }),
    ).rejects.toThrow("Duplicate selected input");
    await expect(
      selectNextDelivery({ ...options(0), groups: [{ items: [] }], prepare: async () => 0 }),
    ).rejects.toThrow("must not be empty");
    await expect(
      selectNextBatch({
        ...options(0),
        readSnapshot: async () => ({ stateRef: ref(99), maxBatch: 17n, context: null }),
        prepare: async () => 0,
      }),
    ).rejects.toThrow("maxBatch");

    const empty = await selectNextDelivery({ ...options(0), prepare: async () => 0 });

    expect(empty).toMatchObject({ prepared: null, included: [], excluded: [], attempts: [] });
  });
});
