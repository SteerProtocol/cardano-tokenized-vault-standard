/** Selects whole groups using measured transaction feasibility while retaining explicit exclusions and pricing context. */
import { type OutRef, refId } from "@ctvs/protocol";

export type ResourceLimit = "memory" | "steps" | "size";

/**
 * Signal that a fully constructed/evaluated candidate exceeded an actual memory,
 * step or size limit in this preparation context. Only this error permits smaller
 * candidates; invalid intent, stale inputs and funding failures must remain ordinary
 * errors. The selector trusts the integration callback to classify failures honestly.
 */
export class ResourceLimitError extends Error {
  constructor(
    readonly resource: ResourceLimit,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ResourceLimitError";
  }
}

/** A changed pricing UTxO invalidates the result; the caller must resolve State and start again. */
export class SelectionStateChangedError extends Error {
  constructor() {
    super("Pricing State changed during selection; resolve and rebuild against the new State");
    this.name = "SelectionStateChangedError";
  }
}

/**
 * One indivisible dependency group in caller priority order. Items in a group are
 * either all selected or all excluded; the selector does not infer dependencies.
 * No group may be empty and no output reference may occur anywhere twice.
 */
export interface SelectionGroup<T> {
  items: readonly T[];
}

/** One actual prepare call, preserving its candidate order and contextual resource outcome. */
export interface SelectionAttempt {
  refs: OutRef[];
  outcome: "feasible" | "resource-limit";
  resource?: ResourceLimit;
  detail?: string;
}

/**
 * An explicit explanation for an omitted reference, not a global infeasibility claim.
 * Structural overflow and untried remainders were not measured. For an atomic-group
 * failure, tested applies to the group and does not imply each member fails alone.
 */
export interface SelectionExclusion {
  ref: OutRef;
  reason:
    | "needs-separate-group"
    | "individual-resource-limit"
    | "atomic-group-resource-limit"
    | "atomic-group-exceeds-structural-limit";
  /** A test applies only to this builder/funding/parameter context; untested means feasibility is unknown. */
  tested: boolean;
  detail: string;
}

/**
 * Selection is a review result, not submission: every supplied reference is included
 * or explicitly excluded in original caller order. The prepared object is exactly
 * what the successful callback returned, so rebuilding it requires fresh measurement.
 */
export interface SelectionResult<T, Prepared> {
  included: T[];
  includedRefs: OutRef[];
  excluded: SelectionExclusion[];
  /** Null when no candidate succeeded, including an empty selection; no transaction is invented. */
  prepared: Prepared | null;
  attempts: SelectionAttempt[];
}

/**
 * Callbacks are trusted integration boundaries, not resource estimates. prepare must
 * complete/evaluate final witness-bearing transactions without submitting them, and
 * must fail on changed protected outputs, insufficient minimum ADA or invalid intent.
 * Only genuine measured memory/step/size failures may become ResourceLimitError.
 */
export interface DeliverySelectionOptions<T, Prepared> {
  /** Caller priority order, including every intended item; items are not globally sorted. */
  groups: readonly SelectionGroup<T>[];
  /** Read once per item during normalization; it must identify the original supplied intent. */
  ref: (item: T) => OutRef;
  /**
   * Validate all intent before retry begins, including groups beyond the structural
   * cap. Validate item/dependency eligibility here without assuming every item can
   * form one legal batch; aggregate candidate constraints belong in prepare.
   */
  validateAll: (items: readonly T[]) => void | Promise<void>;
  /**
   * Construct/evaluate the complete candidate, including funding, final witnesses,
   * fees and minimum ADA, and return that non-null artifact without submitting it.
   * A valid smaller candidate may be tried only after a measured ResourceLimitError.
   */
  prepare: (items: readonly T[]) => Promise<Prepared>;
}

/** Authenticated pricing State and immutable batch cap shared by all attempts in one selection. */
export interface BatchSnapshot<Context> {
  /** A changed reference on the final read discards the candidate; it does not lock this UTxO. */
  stateRef: OutRef;
  /** Resolve this from the immutable authenticated Terms, never a local capacity estimate. */
  maxBatch: bigint;
  /** Integration-owned evidence used by validation/preparation; the selector does not authenticate it. */
  context: Context;
}

/**
 * Batch counterpart to DeliverySelectionOptions. All validation/preparation attempts
 * receive the initial snapshot, followed by a second State-reference read. These
 * callbacks have the same no-submission and measured-error obligations as delivery.
 */
export interface BatchSelectionOptions<T, Context, Prepared> {
  groups: readonly SelectionGroup<T>[];
  ref: (item: T) => OutRef;
  /** Resolve authenticated State and Terms; calls before/after selection must describe current evidence. */
  readSnapshot: () => Promise<BatchSnapshot<Context>>;
  validateAll: (items: readonly T[], snapshot: BatchSnapshot<Context>) => void | Promise<void>;
  prepare: (items: readonly T[], snapshot: BatchSnapshot<Context>) => Promise<Prepared>;
}

/**
 * Copy group containers and capture normalized references before any async work.
 * Reject empty groups, malformed identities and duplicates across group boundaries.
 * Original item objects remain shared with callbacks; this is not a deep immutable
 * snapshot, so integrations must keep their intent stable during selection.
 */
function normalizeGroups<T>(options: Pick<DeliverySelectionOptions<T, unknown>, "groups" | "ref">) {
  const groups = options.groups.map((group) => [...group.items]);
  const items = groups.flat();
  const references = new Map<T, OutRef>();
  const seen = new Set<string>();

  for (const group of groups) {
    if (group.length === 0) throw new Error("Selection groups must not be empty");

    for (const item of group) {
      const ref = options.ref(item);
      const id = refId(ref);

      if (seen.has(id)) throw new Error(`Duplicate selected input ${id}`);

      seen.add(id);
      references.set(item, { txId: ref.txId.toLowerCase(), index: ref.index });
    }
  }

  return { groups, items, references };
}

/**
 * Build contiguous, whole-group prefixes beginning at the requested position and
 * return them longest first. Stop before exceeding the structural item cap without
 * skipping a blocking group. These candidates are not resource estimates; prepare
 * must measure each attempted transaction independently.
 */
function boundedPrefixes<T>(groups: T[][], start: number, limit: number): T[][] {
  const prefixes: T[][] = [];
  let candidate: T[] = [];

  for (let end = start; end < groups.length; end++) {
    const group = groups[end];

    if (!group || candidate.length + group.length > limit) break;

    candidate = [...candidate, ...group];
    prefixes.push(candidate);
  }

  return prefixes.reverse();
}

/**
 * Validate all intent, then try longest whole-group prefixes at the earliest viable
 * starting group. Only measured resource failures justify shortening a candidate;
 * all other failures abort. After every prefix containing a head group fails, report
 * that group's failure and consider the next head. Mixed transaction feasibility is
 * not assumed monotonic, and this search does not find an optimal subset. Return the
 * successful artifact plus a complete ordered account of all omitted references.
 */
async function select<T, Prepared>(
  options: DeliverySelectionOptions<T, Prepared>,
  limit: number,
): Promise<SelectionResult<T, Prepared>> {
  const { groups, items, references } = normalizeGroups(options);

  const refs = (selected: readonly T[]): OutRef[] =>
    selected.map((item) => {
      const ref = references.get(item);

      if (!ref) throw new Error("Unknown selected item");

      return ref;
    });

  // This is deliberately outside the retry catch: invalid intent must not be omitted.
  await options.validateAll(items);

  const attempts: SelectionAttempt[] = [];
  const excluded = new Map<string, SelectionExclusion>();

  const exclude = (
    selected: readonly T[],
    reason: SelectionExclusion["reason"],
    tested: boolean,
    detail: string,
  ) => {
    for (const ref of refs(selected)) excluded.set(refId(ref), { ref, reason, tested, detail });
  };

  // A remainder is untested, not a measured failure. Preserve earlier explicit group exclusions
  // while accounting for every item that lies outside the successful contiguous candidate.
  const finish = (included: T[], prepared: Prepared | null): SelectionResult<T, Prepared> => {
    const includedRefs = refs(included);
    const accepted = new Set(includedRefs.map(refId));

    for (const item of items) {
      const ref = refs([item])[0];

      if (!ref) throw new Error("Missing selected reference");

      if (!accepted.has(refId(ref)) && !excluded.has(refId(ref))) {
        exclude(
          [item],
          "needs-separate-group",
          false,
          "Outside the chosen group; resolve fresh State/funding and test again before submission",
        );
      }
    }

    return {
      included,
      includedRefs,
      excluded: refs(items).flatMap((ref) => {
        const entry = excluded.get(refId(ref));

        return entry ? [entry] : [];
      }),
      prepared,
      attempts,
    };
  };

  for (let start = 0; start < groups.length; start++) {
    const head = groups[start];

    if (!head) throw new Error("Missing selection group");

    // A group that cannot fit the immutable cap is never partially prepared or split.
    if (head.length > limit) {
      exclude(
        head,
        "atomic-group-exceeds-structural-limit",
        false,
        `Indivisible group contains ${head.length} inputs; immutable limit is ${limit}`,
      );
      continue;
    }

    let lastFailure: ResourceLimitError | undefined;

    // Descending complete attempts preserve nonmonotonic feasibility in mixed request batches.
    for (const prefix of boundedPrefixes(groups, start, limit)) {
      try {
        const prepared = await options.prepare(prefix);

        if (prepared === null || prepared === undefined)
          throw new Error("Preparation must return the measured candidate");

        attempts.push({ refs: refs(prefix), outcome: "feasible" });

        return finish(prefix, prepared);
      } catch (error) {
        if (!(error instanceof ResourceLimitError)) throw error;

        lastFailure = error;
        attempts.push({
          refs: refs(prefix),
          outcome: "resource-limit",
          resource: error.resource,
          detail: error.message,
        });
      }
    }

    if (!lastFailure) throw new Error("No resource evaluation for selected group");

    exclude(
      head,
      head.length === 1 ? "individual-resource-limit" : "atomic-group-resource-limit",
      true,
      lastFailure.message,
    );
  }

  return finish([], null);
}

/**
 * Price all attempts against one authenticated State/Terms snapshot and its maxBatch,
 * then reject the result if a final read names a different State UTxO. Return the
 * measured candidate with its pricing reference, without submitting or repricing it.
 * This detects reference changes during preparation only: it does not reserve State
 * or funding, recheck protocol parameters, or eliminate races after the final read.
 * Reinvoke after accepted settlement and refresh evidence before later submission.
 */
export async function selectNextBatch<T, Context, Prepared>(
  options: BatchSelectionOptions<T, Context, Prepared>,
): Promise<SelectionResult<T, Prepared> & { pricingBasis: OutRef }> {
  const snapshot = await options.readSnapshot();

  if (typeof snapshot.maxBatch !== "bigint" || snapshot.maxBatch < 1n || snapshot.maxBatch > 16n)
    throw new RangeError("Immutable maxBatch must be in 1..16");

  const pricingId = refId(snapshot.stateRef);
  const result = await select(
    {
      groups: options.groups,
      ref: options.ref,
      validateAll: (items) => options.validateAll(items, snapshot),
      prepare: (items) => options.prepare(items, snapshot),
    },
    Number(snapshot.maxBatch),
  );

  // State consumption invalidates prices even when the previously prepared transaction fits.
  // This detects changes during preparation; it does not reserve State or wallet funding for submission.
  if (refId((await options.readSnapshot()).stateRef) !== pricingId)
    throw new SelectionStateChangedError();

  return { ...result, pricingBasis: snapshot.stateRef };
}

/**
 * Select whole Claim groups under the profile's 16-entry structural cap. Claim
 * outcomes need no pricing-State reread, but every attempted delivery still requires
 * complete construction/evaluation and current funding evidence from the callbacks.
 * The result reserves no Claim UTxOs and makes no feasibility claim about its remainder.
 */
export async function selectNextDelivery<T, Prepared>(
  options: DeliverySelectionOptions<T, Prepared>,
): Promise<SelectionResult<T, Prepared>> {
  return select(options, 16);
}
