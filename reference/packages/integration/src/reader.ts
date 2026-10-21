/** Chain-point-bound facade and atomic publication over a trusted accepted-block journal. */
import { verifyTransactionEffects, type WalletAuthorization } from "@ctvs/cardano";
import type { ChainPoint, TransactionPlan } from "@ctvs/planning";
import { type Address, NAMES, type Operation, type OutRef, refId } from "@ctvs/protocol";
import { emptyProjection, projectTransaction } from "./project.js";
import { QueryError } from "./query/schema.js";
import type {
  ClaimView,
  ConstructionContext,
  EconomicMethod,
  EconomicView,
  PreviewInput,
  RequestView,
  ShareInput,
} from "./query/types.js";
import {
  assertConstructionBinding,
  assertCurrentPlanInputs,
  rawSource,
  recoveryData,
} from "./reader/construction.js";
import { candidateData, claimData, requestData } from "./reader/lifecycle.js";
import { ownershipData } from "./reader/ownership.js";
import { economicData, quoteData, snapshotData } from "./reader/views.js";
import type {
  AcceptedBlock,
  Envelope,
  NetworkBinding,
  Observation,
  Projection,
  ReviewedBuild,
  VaultRecord,
} from "./types.js";

const known = <T>(value: T): Observation<T> => ({ status: "known", value });

const samePoint = (a: ChainPoint, b: ChainPoint) =>
  a.slot === b.slot && a.blockHash === b.blockHash;

/** Validate the local cursor shape only; block membership and chain selection come from the feed. */
function checkPoint(point: ChainPoint): void {
  if (typeof point.slot !== "bigint" || point.slot < 0n || !/^[a-f0-9]{64}$/.test(point.blockHash))
    throw new Error("invalid chain point");
}

/** Counts used by a host to bound retained history and projection growth before publication. */
export interface ReaderCounts {
  blocks: number;
  transactions: number;
  utxos: number;
  vaults: number;
  requests: number;
  claims: number;
}

/** Privately validated update; a host persists its event before invoking the one-use publish function. */
export interface PreparedReaderUpdate {
  readonly counts: Readonly<ReaderCounts>;
  publish(): void;
}

function projectionCounts(projection: Projection, blocks: number): ReaderCounts {
  return {
    blocks,
    transactions: projection.transactions.size,
    utxos: projection.utxos.size,
    vaults: projection.vaults.size,
    requests: projection.requests.size,
    claims: projection.claims.size,
  };
}

/**
 * In-memory reader over caller-authenticated blocks and pinned script builds.
 * It checks projection invariants, not consensus, signatures or complete ledger rules.
 * Start before the vault genesis to establish origin; no pre-intersection state is
 * imported. The retained journal enables rollback by replay and must be persisted
 * externally when durability is needed. Returned views are detached snapshots.
 */
export class VaultReader {
  readonly #network: NetworkBinding;
  readonly #builds: readonly ReviewedBuild[];
  readonly #intersection: ChainPoint;
  #blocks: AcceptedBlock[] = [];
  #projection: Projection = emptyProjection();
  #point: ChainPoint;
  #revision = 0;
  readonly #vaultPolicies: ReadonlySet<string> | null;

  /**
   * Pin trusted network/build inputs and an initially empty journal intersection.
   * Shape checks and one build per family prevent ambiguous local configuration;
   * they do not verify the node connection or independently audit supplied scripts.
   * Defensive copies prevent later caller mutation from changing that trust basis.
   */
  constructor(
    network: NetworkBinding,
    reviewedBuilds: readonly ReviewedBuild[],
    intersection: ChainPoint,
    options: { vaultPolicies?: readonly string[] } = {},
  ) {
    checkPoint(intersection);

    if (
      ![0, 1].includes(network.networkId) ||
      !Number.isSafeInteger(network.networkMagic) ||
      network.networkMagic < 0 ||
      !/^[a-f0-9]{64}$/.test(network.domain) ||
      !/^[a-f0-9]{64}$/.test(network.genesisHash)
    )
      throw new Error("invalid trusted network binding");

    if (
      reviewedBuilds.length === 0 ||
      new Set(reviewedBuilds.map((b) => b.family)).size !== reviewedBuilds.length
    )
      throw new Error("supply one reviewed build per enabled family");

    this.#network = structuredClone(network);
    this.#builds = structuredClone(reviewedBuilds);
    this.#intersection = structuredClone(intersection);
    this.#point = structuredClone(intersection);

    const policies = options.vaultPolicies?.map((policy) => policy.toLowerCase());

    if (
      policies?.some((policy) => !/^[a-f0-9]{56}$/.test(policy)) ||
      (policies && new Set(policies).size !== policies.length)
    )
      throw new Error("invalid or duplicate selected vault policy");

    this.#vaultPolicies = policies ? new Set(policies) : null;
  }

  /**
   * Check freshness of a response previously obtained from this reader by chain point
   * and retained genesis identity. This is not a signature or content-integrity check
   * for untrusted envelopes. Any chain-point advance requires a fresh response, even
   * if that block did not change the vault's State.
   */
  responseStatus(response: Envelope<unknown>): Observation<true> {
    const current = this.#projection.vaults.get(response.vault.policy);

    return samePoint(response.chainPoint, this.#point) &&
      current?.genesis.txId === response.evidence.genesis
      ? known(true)
      : {
          status: "stale",
          reason: "chain point or authenticated history changed; refresh the response",
        };
  }

  /** Return a detached feed cursor; its presence does not assert finality of that block. */
  get chainPoint(): ChainPoint {
    return structuredClone(this.#point);
  }

  /** Detached resource counts; includes unrelated UTxOs still retained by this reference reader. */
  get counts(): ReaderCounts {
    return projectionCounts(this.#projection, this.#blocks.length);
  }

  /**
   * Append one contiguous accepted block in transaction order. Clone the projection
   * first and publish it with the journal/cursor only after every transaction succeeds.
   * A duplicate transaction or failed invariant therefore leaves the previous view
   * intact. Empty blocks still advance the response freshness boundary.
   */
  rollForward(block: AcceptedBlock): void {
    this.prepareForward(block).publish();
  }

  /** Validate without publication, allowing a durable host to commit before changing the served view. */
  prepareForward(block: AcceptedBlock): PreparedReaderUpdate {
    checkPoint(block.point);

    if (!samePoint(block.parent, this.#point) || block.point.slot <= block.parent.slot)
      throw new Error("noncontiguous accepted block feed");

    // Helpers mutate their argument and can throw after partial work; never pass the published projection.
    const next = structuredClone(this.#projection);

    for (const tx of block.transactions)
      projectTransaction(next, tx, block.point, this.#network, this.#builds, this.#vaultPolicies);

    const retained = [...this.#blocks, structuredClone(block)];

    return this.#prepared(next, retained, block.point);
  }

  /**
   * Rebuild from the retained intersection through an exact known block point.
   * Replay reverses origins, settlement, delivery and UTxO ownership together rather
   * than attempting partial inverse updates. Unknown points throw before publication;
   * rolling back to the intersection empties the view and permits a competing branch.
   */
  rollBackward(point: ChainPoint): void {
    this.prepareBackward(point).publish();
  }

  /** Reconstruct a retained prefix privately; persistence and publication remain separate host steps. */
  prepareBackward(point: ChainPoint): PreparedReaderUpdate {
    checkPoint(point);

    const index = samePoint(point, this.#intersection)
      ? -1
      : this.#blocks.findIndex((block) => samePoint(block.point, point));

    if (index < 0 && !samePoint(point, this.#intersection))
      throw new Error(
        "rollback precedes retained intersection; restart from an earlier trusted point",
      );

    const retained = this.#blocks.slice(0, index + 1);
    const next = emptyProjection();

    for (const block of retained)
      for (const tx of block.transactions)
        projectTransaction(next, tx, block.point, this.#network, this.#builds, this.#vaultPolicies);

    return this.#prepared(next, retained, point);
  }

  /** Reject reused or overtaken preparation tokens before any mutation of the published reader. */
  #prepared(next: Projection, retained: AcceptedBlock[], point: ChainPoint): PreparedReaderUpdate {
    const revision = this.#revision;
    const cursor = structuredClone(point);
    let published = false;

    return Object.freeze({
      counts: Object.freeze(projectionCounts(next, retained.length)),
      publish: () => {
        if (published || revision !== this.#revision)
          throw new Error("prepared reader update is stale or already published");

        this.#blocks = retained;
        this.#projection = next;
        this.#point = cursor;
        this.#revision++;
        published = true;
      },
    });
  }

  /**
   * Resolve only a policy whose genesis was authenticated in retained history.
   * The private result is the live record; public callers receive cloned contexts
   * or envelopes rather than references they could use to mutate the projection.
   */
  #vault(policy: string): VaultRecord {
    if (this.#vaultPolicies && !this.#vaultPolicies.has(policy.toLowerCase()))
      throw new QueryError("OUTSIDE_SCOPE", "vault is outside configured tracking scope", 403);

    const vault = this.#projection.vaults.get(policy.toLowerCase());

    if (!vault)
      throw new QueryError(
        "HISTORY_INCOMPLETE",
        "vault has no authenticated genesis in retained history",
        404,
      );

    return vault;
  }

  /**
   * Attach the same network, implementation, origin and current-State evidence to
   * each response shape, explicitly identifying the accepted-feed trust boundary.
   * Clone the entire envelope so nested maps, values and datums do not expose mutable
   * projection records. The conformance label is a profile claim, not a ledger proof.
   */
  #response<T>(vault: VaultRecord, kind: string, data: T): Envelope<T> {
    return structuredClone({
      schema: "CTVS-INTEGRATION-0.6",
      kind,
      network: this.#network,
      chainPoint: this.#point,
      vault: {
        policy: vault.deployment.policy,
        share: `${vault.deployment.policy}.${NAMES.share}`,
        configRef: vault.deployment.configRef,
      },
      implementation: {
        family: vault.deployment.family,
        buildId: vault.deployment.buildId,
        profile: 0,
        wire: 2,
      },
      claimedConformance: "profile-0-reference-semantics",
      evidence: {
        genesis: vault.genesis.txId,
        state: vault.state.ref,
        termsHash: vault.deployment.termsHash,
      },
      verification: {
        disposition: "accepted_chain_and_reviewed_build",
        consensusSource: "trusted_accepted_block_feed",
        independentLedgerValidation: false,
      },
      data,
    });
  }

  /**
   * Discover by the exact SHARE asset identifier, never by ticker, metadata or script
   * address resemblance. A recognized name still needs retained authenticated genesis;
   * successful discovery returns the same chain-point-bound view as snapshot().
   */
  discover(share: string) {
    const normalized = share.toLowerCase();
    const policy = normalized.split(".")[0] ?? "";

    if (normalized !== `${policy}.${NAMES.share}`)
      throw new Error("expected the exact SHARE asset identifier");

    return this.snapshot(policy);
  }

  /**
   * Return detached planner inputs: authenticated deployment, immutable Terms and the
   * current State UTxO. Stamp the deployment with the current reader point even when
   * State last moved in an earlier block. This snapshot does not reserve its inputs.
   */
  context(policy: string) {
    const vault = this.#vault(policy);

    return structuredClone({
      deployment: { ...vault.deployment, chainPoint: this.#point },
      terms: vault.terms,
      stateInput: vault.state,
    });
  }

  constructionContext(policy: string): ConstructionContext {
    const vault = this.#vault(policy);
    const source = this.#projection.utxos.get(refId(vault.state.ref));

    if (!source) throw new QueryError("NOT_FOUND", "current State is not unspent", 409);

    return structuredClone({
      ...this.context(policy),
      stateInput: rawSource(source, vault.deployment.policy, this.#network.networkId),
    });
  }

  #economic(
    policy: string,
    method: EconomicMethod,
    input: PreviewInput | ShareInput,
  ): Envelope<EconomicView> {
    const vault = this.#vault(policy);

    return this.#response(
      vault,
      method,
      economicData(vault, method, input, () => this.constructionContext(policy)),
    );
  }

  convertToAssets(policy: string, input: { shares: bigint }) {
    return this.#economic(policy, "convertToAssets", input);
  }

  convertToShares(policy: string, input: { assets: bigint }) {
    return this.#economic(policy, "convertToShares", input);
  }

  previewDeposit(policy: string, input: PreviewInput) {
    return this.#economic(policy, "previewDeposit", input);
  }

  previewMint(policy: string, input: ShareInput) {
    return this.#economic(policy, "previewMint", input);
  }

  previewWithdraw(policy: string, input: PreviewInput) {
    return this.#economic(policy, "previewWithdraw", input);
  }

  previewRedeem(policy: string, input: ShareInput) {
    return this.#economic(policy, "previewRedeem", input);
  }

  /** Lifecycle data retains history; only the explicit unspent flag authorizes a planner source handoff. */
  requestView(policy: string, ref: OutRef): Envelope<RequestView> {
    const vault = this.#vault(policy);
    const { data } = this.request(policy, ref);

    return this.#response(vault, "request", {
      ref: data.ref,
      policy: data.policy,
      recovery: data.recovery,
      request: data.request,
      created: data.created,
      status: data.status,
      settlement: data.settlement,
      completion: data.completion,
      source: rawSource(data.source, vault.deployment.policy, this.#network.networkId),
      unspent: this.#projection.utxos.has(refId(ref)),
      validation: data.requestValidation,
    });
  }

  claimView(policy: string, ref: OutRef): Envelope<ClaimView> {
    const vault = this.#vault(policy);
    const { data } = this.claim(policy, ref);

    return this.#response(vault, "claim", {
      ref: data.ref,
      claim: data.claim,
      source: rawSource(data.source, vault.deployment.claimScript ?? "", this.#network.networkId),
      unspent: !data.delivered && this.#projection.utxos.has(refId(ref)),
    });
  }

  /**
   * Expose direct-custody accounting in ledger integer units from the current State.
   * Backing, excluded fees and storage reserve remain separate; arbitrary UTxOs or
   * pending deposits do not increase backing here. Available liquidity is the State's
   * backing quantity, not a promise that a funded transaction can currently execute.
   */
  snapshot(policy: string) {
    const vault = this.#vault(policy);

    return this.#response(vault, "snapshot", snapshotData(vault));
  }

  /**
   * Preview math at the current State and separately report transition availability.
   * Preview/input errors may throw; economic transition failures become unsupported
   * observations. CTVS-2 prices are indicative until settlement. Network fees, complete
   * construction capacity and non-deposit maximums remain unknown rather than guessed.
   */
  quote(policy: string, operation: Operation, amount: bigint) {
    const vault = this.#vault(policy);

    return this.#response(vault, "quote", quoteData(vault, operation, amount));
  }

  /**
   * Report a recognized Request's retained lifecycle, funding validation and lineage.
   * Recognition alone is not economic support: opaque/mismatched economics can retain
   * a usable Recovery envelope. Historical consumed Requests remain queryable, but
   * recovery becomes not applicable; settlement and final delivery are separate events.
   * Missing origin or a Request belonging to another vault throws.
   */
  request(policy: string, ref: OutRef) {
    const vault = this.#vault(policy);

    return this.#response(vault, "request", requestData(this.#projection, vault, ref));
  }

  /**
   * Return a recognized pending CTVS-2 source for cancellation or expiry construction.
   * Preserve the observed inline CBOR instead of decoding/re-encoding unsupported
   * economics, and retain its complete source value. Construction and signing must
   * still satisfy the controller-witness or expiry-interval requirements.
   */
  recoverySource(policy: string, ref: OutRef) {
    return recoveryData(this.#projection, this.#vault(policy), ref, this.#network, this.#point);
  }

  /**
   * Diagnose an observed output at this vault without promoting it to a vault liability.
   * Recovery metadata and economic support are independent observations. Recognized
   * Requests can be returned from retained history even after consumption; use request()
   * for lifecycle or recoverySource() for a pending source. Missing output origin throws.
   */
  candidate(policy: string, ref: OutRef) {
    const vault = this.#vault(policy);

    return this.#response(
      vault,
      "request_candidate",
      candidateData(this.#projection, vault, ref, this.#network),
    );
  }

  /**
   * Return only Claims installed by authenticated settlement lineage, including their
   * retained delivered flag. A funded lookalike at the Claim script is insufficient.
   * Delivery does not erase the record; rollback reconstructs its prior lifecycle.
   */
  claim(policy: string, ref: OutRef) {
    const vault = this.#vault(policy);

    return this.#response(vault, "claim", claimData(this.#projection, vault, ref));
  }

  /**
   * Partition observed entitlement into free SHARE, redemption escrow, issued Claims,
   * pending deposit assets and fixed asset Claims without summing unlike categories.
   * Refund ownership, cancellation control and final receiver may name different users.
   * Results cover retained accepted history, not a separate wallet/provider inventory;
   * unsupported Requests are counted rather than assigned invented economic amounts.
   */
  ownership(policy: string, owner: Address) {
    const vault = this.#vault(policy);

    return this.#response(vault, "ownership", ownershipData(this.#projection, vault, owner));
  }

  /**
   * Bind an effects review to this deployment, current reader point and indexed
   * protected inputs before delegating complete supported-body checks to the Cardano
   * verifier. Funding/reference evidence still comes from wallet authorization.
   * The returned approval does not sign, submit, reserve inputs or establish ledger
   * acceptance; an advance or rollback can make the construction stale.
   */
  effects(policy: string, cbor: string, plan: TransactionPlan, authorization: WalletAuthorization) {
    const vault = this.#vault(policy);

    assertConstructionBinding(vault, this.#network, this.#point, plan, authorization);
    assertCurrentPlanInputs(this.#projection, vault, plan, authorization);

    return this.#response(
      vault,
      "constructed_effects",
      verifyTransactionEffects(cbor, plan, authorization),
    );
  }
}
