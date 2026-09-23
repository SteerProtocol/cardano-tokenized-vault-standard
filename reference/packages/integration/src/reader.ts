/** Chain-point-bound views and construction checks over a trusted accepted-block journal, without consensus validation. */
import { verifyTransactionEffects, type WalletAuthorization } from "@ctvs/cardano";
import {
  assertSameValue,
  type ChainPoint,
  requestValue,
  type TransactionPlan,
} from "@ctvs/planning";
import {
  type Address,
  addressData,
  assetId,
  equalData,
  maxDeposit,
  NAMES,
  type Operation,
  type OutRef,
  preview,
  refId,
  stateFromData,
  transition,
} from "@ctvs/protocol";
import { getAddressDetails } from "@lucid-evolution/lucid";
import { protectedMetadata } from "./ledger.js";
import { emptyProjection, projectTransaction } from "./project.js";
import type {
  AcceptedBlock,
  Envelope,
  NetworkBinding,
  Observation,
  Projection,
  RequestRecord,
  ReviewedBuild,
  VaultRecord,
} from "./types.js";

const known = <T>(value: T): Observation<T> => ({ status: "known", value });

const unknown = (reason: string): Observation<never> => ({ status: "unknown", reason });

const samePoint = (a: ChainPoint, b: ChainPoint) =>
  a.slot === b.slot && a.blockHash === b.blockHash;

/** Validate the local cursor shape only; block membership and chain selection come from the feed. */
function checkPoint(point: ChainPoint): void {
  if (point.slot < 0n || !/^[a-f0-9]{64}$/.test(point.blockHash))
    throw new Error("invalid chain point");
}

/**
 * Match payment and stake credentials for the Address forms this profile represents.
 * Pointer and other address forms return false rather than collapsing an unresolved
 * stake reference into an enterprise address. Network provenance comes from the feed.
 */
function sameAddress(bech32: string, address: Address): boolean {
  const actual = getAddressDetails(bech32);

  if (actual.type !== "Base" && actual.type !== "Enterprise") return false;

  const credential = (a: { type: string; hash: string } | undefined, b: Address["stake"]) =>
    b === null ? !a : a?.type.toLowerCase() === b.type && a.hash === b.hash.toLowerCase();

  return (
    credential(actual.paymentCredential, address.payment) &&
    credential(actual.stakeCredential, address.stake)
  );
}

/**
 * Classify whether recognized Request economics match this vault's Terms and exact
 * escrow composition. A known result does not promise settlement: current State,
 * bounds, expiry and transaction construction still need their operation checks.
 * Unsupported economics remain an observation so their Recovery path stays visible.
 */
function requestValidation(record: RequestRecord, vault: VaultRecord): Observation<boolean> {
  try {
    if (!record.request || record.request.body.termsHash !== vault.deployment.termsHash)
      throw new Error("unsupported economics or Terms");

    assertSameValue(record.source.value, requestValue(record.request, vault.terms));

    return known(true);
  } catch (error) {
    return {
      status: "unsupported",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Sum observed unspent SHARE at the complete owner address, excluding tracked escrow
 * and Claims that are reported separately. Zero means none in the retained projection,
 * not proof that an arbitrary wallet has no holdings outside the replayed history.
 */
function freeShareBalance(projection: Projection, owner: Address, unit: string): bigint {
  let freeShares = 0n;

  for (const utxo of projection.utxos.values())
    if (
      sameAddress(utxo.address, owner) &&
      !projection.claims.has(refId(utxo.ref)) &&
      !projection.requests.has(refId(utxo.ref))
    )
      freeShares += utxo.value[unit] ?? 0n;

  return freeShares;
}

/**
 * Keep cancellation authority separate from the destination entitled to a refund.
 * A matching controller can be reported even when a different address receives funds.
 * Only pending Requests with supported, correctly funded economics enter asset/share
 * subtotals; unsupported Requests for the refund owner are counted without a valuation.
 */
function pendingRequestOwnership(
  projection: Projection,
  vault: VaultRecord,
  owner: Address,
): {
  lockedRedemptionShares: bigint;
  pendingDepositAssets: bigint;
  unsupportedRequests: number;
  controlledRequests: OutRef[];
} {
  const controlledRequests: OutRef[] = [];
  let lockedRedemptionShares = 0n,
    pendingDepositAssets = 0n,
    unsupportedRequests = 0;

  for (const request of projection.requests.values()) {
    if (request.policy !== vault.deployment.policy || request.status !== "pending_escrow") continue;

    if (
      owner.payment.type === "key" &&
      request.recovery.controller === owner.payment.hash.toLowerCase()
    )
      controlledRequests.push(request.ref);

    if (!equalData(addressData(request.recovery.refund.address), addressData(owner))) continue;

    const participation = requestValidation(request, vault);

    if (!request.request || participation.status !== "known") {
      unsupportedRequests++;
      continue;
    }

    if (request.request.body.kind === "deposit")
      pendingDepositAssets += request.request.body.offered;
    else lockedRedemptionShares += request.request.body.offered;
  }

  return { lockedRedemptionShares, pendingDepositAssets, unsupportedRequests, controlledRequests };
}

/**
 * Aggregate authenticated, undelivered Claims by their recorded receiver, which can
 * differ from the original controller and refund destination. Issued SHARE remains
 * part of economic supply while escrowed here; fixed asset Claims have already exited.
 * Use economicQuantity so carried storage lovelace is not counted as an entitlement.
 */
function undeliveredClaimOwnership(
  projection: Projection,
  vault: VaultRecord,
  owner: Address,
  unit: string,
): { issuedUndeliveredShares: bigint; fixedAssetClaims: bigint } {
  let issuedUndeliveredShares = 0n,
    fixedAssetClaims = 0n;

  for (const record of projection.claims.values()) {
    if (record.delivered || record.claim.vaultPolicy !== vault.deployment.policy) continue;

    const destination = record.claim.receiver.address;

    if (!equalData(addressData(destination), addressData(owner))) continue;

    if (assetId(record.claim.asset) === unit)
      issuedUndeliveredShares += record.claim.economicQuantity;
    else fixedAssetClaims += record.claim.economicQuantity;
  }

  return { issuedUndeliveredShares, fixedAssetClaims };
}

/**
 * Reject a plan from another deployment or reader snapshot before comparing effects.
 * Policy, Terms and reviewed build identities bind semantics; the exact chain point
 * prevents an older quote from becoming current merely because its CBOR still balances.
 * Network authorization must also agree with the caller-pinned reader connection.
 */
function assertConstructionBinding(
  vault: VaultRecord,
  network: NetworkBinding,
  point: ChainPoint,
  plan: TransactionPlan,
  authorization: WalletAuthorization,
): void {
  const expected = vault.deployment,
    actual = plan.implementation;

  if (
    actual.policy.toLowerCase() !== expected.policy ||
    actual.family !== expected.family ||
    actual.buildId !== expected.buildId ||
    actual.termsHash.toLowerCase() !== expected.termsHash ||
    actual.configLock.toLowerCase() !== expected.configLock ||
    actual.claimScript?.toLowerCase() !== expected.claimScript?.toLowerCase() ||
    !samePoint(plan.chainPoint, point) ||
    authorization.networkName !== network.name ||
    authorization.networkDomain.toLowerCase() !== network.domain ||
    authorization.networkId !== network.networkId
  )
    throw new Error("construction is stale or bound to another vault/network/build");
}

/**
 * Corroborate planned protected inputs against unspent outputs in this projection.
 * Matching address/value and absent reference scripts prevent substituted evidence;
 * a State input must additionally be the current pricing State. Wallet funding and
 * other authorization sources remain the caller's responsibility, outside this check.
 */
function assertCurrentPlanInputs(
  projection: Projection,
  vault: VaultRecord,
  plan: TransactionPlan,
  authorization: WalletAuthorization,
): void {
  for (const input of plan.inputs) {
    const source = projection.utxos.get(refId(input.ref));
    const resolved = authorization.planInputs.find((item) => refId(item.ref) === refId(input.ref));

    if (
      !source ||
      !resolved ||
      source.address !== resolved.address ||
      source.scriptRef ||
      resolved.referenceScript
    )
      throw new Error("protected input evidence does not match current indexed UTxO");

    assertSameValue(resolved.value, source.value);

    if (input.role === "state" && refId(input.ref) !== refId(vault.state.ref))
      throw new Error("pricing State is stale");
  }
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

  /**
   * Append one contiguous accepted block in transaction order. Clone the projection
   * first and publish it with the journal/cursor only after every transaction succeeds.
   * A duplicate transaction or failed invariant therefore leaves the previous view
   * intact. Empty blocks still advance the response freshness boundary.
   */
  rollForward(block: AcceptedBlock): void {
    checkPoint(block.point);

    if (!samePoint(block.parent, this.#point) || block.point.slot <= block.parent.slot)
      throw new Error("noncontiguous accepted block feed");

    // Helpers mutate their argument and can throw after partial work; never pass the published projection.
    const next = structuredClone(this.#projection);

    for (const tx of block.transactions)
      projectTransaction(next, tx, block.point, this.#network, this.#builds);

    this.#blocks.push(structuredClone(block));
    this.#projection = next;
    this.#point = structuredClone(block.point);
  }

  /**
   * Rebuild from the retained intersection through an exact known block point.
   * Replay reverses origins, settlement, delivery and UTxO ownership together rather
   * than attempting partial inverse updates. Unknown points throw before publication;
   * rolling back to the intersection empties the view and permits a competing branch.
   */
  rollBackward(point: ChainPoint): void {
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
        projectTransaction(next, tx, block.point, this.#network, this.#builds);

    this.#blocks = retained;
    this.#projection = next;
    this.#point = structuredClone(point);
  }

  /**
   * Resolve only a policy whose genesis was authenticated in retained history.
   * The private result is the live record; public callers receive cloned contexts
   * or envelopes rather than references they could use to mutate the projection.
   */
  #vault(policy: string): VaultRecord {
    const vault = this.#projection.vaults.get(policy.toLowerCase());

    if (!vault) throw new Error("vault has no authenticated genesis in retained history");

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

  /**
   * Expose direct-custody accounting in ledger integer units from the current State.
   * Backing, excluded fees and storage reserve remain separate; arbitrary UTxOs or
   * pending deposits do not increase backing here. Available liquidity is the State's
   * backing quantity, not a promise that a funded transaction can currently execute.
   */
  snapshot(policy: string) {
    const vault = this.#vault(policy),
      state = stateFromData(vault.state.datum);

    return this.#response(vault, "snapshot", {
      underlying: assetId(vault.terms.underlying),
      quantityUnit: "ledger_integer_quantity",
      state,
      terms: vault.terms,
      backingAssets: known(state.backingAssets),
      economicSupply: known(state.economicSupply),
      excludedFees: known(state.accruedFees),
      excludedReserve: known(state.storageLovelace),
      availableLiquidity: known(state.backingAssets),
      executionModes: vault.terms.executionModes,
      pauseFlags: state.pauseFlags,
      pricing: "direct_custody_at_chain_point",
      constructionCapacity: unknown(
        "requires current protocol parameters and evaluation of the complete transaction",
      ),
    });
  }

  /**
   * Preview math at the current State and separately report transition availability.
   * Preview/input errors may throw; economic transition failures become unsupported
   * observations. CTVS-2 prices are indicative until settlement. Network fees, complete
   * construction capacity and non-deposit maximums remain unknown rather than guessed.
   */
  quote(policy: string, operation: Operation, amount: bigint) {
    const vault = this.#vault(policy),
      state = stateFromData(vault.state.datum);
    const asynchronous = vault.deployment.family === "ctvs2";
    const quote = preview(operation, amount, state, vault.terms);
    let availability: Observation<boolean>;

    try {
      transition(
        operation,
        amount,
        operation === "mint" ? quote.grossAssets : operation === "withdraw" ? quote.shares : 1n,
        state,
        vault.terms,
        { asynchronous },
      );
      availability = known(true);
    } catch (error) {
      availability = {
        status: "unsupported",
        reason: error instanceof Error ? error.message : String(error),
      };
    }

    return this.#response(vault, "quote", {
      operation,
      amount,
      result: known(quote),
      availability,
      pricingBasis: vault.state.ref,
      pricing: asynchronous ? "indicative_until_settlement" : "exact_at_snapshot",
      economicMaximum:
        operation === "deposit"
          ? maxDeposit(state, vault.terms, { asynchronous })
          : unknown("no operation-specific maximum solver exposed"),
      constructionMaximum: unknown("complete transaction evaluation required"),
      fees: {
        protocol: known(quote.fee),
        network: unknown("not constructed"),
        settler: asynchronous
          ? unknown("Request-specific fee")
          : { status: "not_applicable", reason: "direct operation" },
      },
      expiry: { invalidatedBy: "State consumption or rollback", stateRef: vault.state.ref },
      prerequisites: [
        "unspent State at the stated chain point",
        "user bound and destination",
        "wallet funding and witnesses",
        "ledger-valid constructed transaction",
      ],
    });
  }

  /**
   * Report a recognized Request's retained lifecycle, funding validation and lineage.
   * Recognition alone is not economic support: opaque/mismatched economics can retain
   * a usable Recovery envelope. Historical consumed Requests remain queryable, but
   * recovery becomes not applicable; settlement and final delivery are separate events.
   * Missing origin or a Request belonging to another vault throws.
   */
  request(policy: string, ref: OutRef) {
    const vault = this.#vault(policy),
      record = this.#projection.requests.get(refId(ref));

    if (!record || record.policy !== vault.deployment.policy)
      throw new Error("Request has no accepted origin for this vault");

    const participation = requestValidation(record, vault);

    return this.#response(vault, "request", {
      ...record,
      requestValidation: participation,
      participation: {
        pendingDepositAssetsInBacking: false,
        redemptionEscrowSharesParticipate:
          participation.status === "known" &&
          record.request?.body.kind === "redeem" &&
          record.status === "pending_escrow",
        // Issued SHARE stays in supply even when the surrounding economic body is unsupported.
        escrowedSharesParticipating:
          record.status === "pending_escrow"
            ? (record.source.value[`${vault.deployment.policy}.${NAMES.share}`] ?? 0n)
            : 0n,
        issuedUndeliveredSharesParticipate:
          record.request?.body.kind === "deposit" && record.status === "claimable",
        fixedAssetClaimsParticipate: false,
        settlementRealized: record.settlement !== null,
      },
      recoveryAvailability:
        record.status === "pending_escrow"
          ? known({
              cancel: "controller witness required",
              expiry: "finite validity lower bound at or after deadline",
              deadlinePosixMs: record.recovery.deadlinePosixMs,
              fullSourceValue: record.source.value,
            })
          : { status: "not_applicable", reason: "Request already consumed" },
      delivery: record.settlement
        ? known(this.#projection.claims.get(refId(record.settlement.claimRef)))
        : unknown("not settled"),
    });
  }

  /**
   * Return a recognized pending CTVS-2 source for cancellation or expiry construction.
   * Preserve the observed inline CBOR instead of decoding/re-encoding unsupported
   * economics, and retain its complete source value. Construction and signing must
   * still satisfy the controller-witness or expiry-interval requirements.
   */
  recoverySource(policy: string, ref: OutRef) {
    const vault = this.#vault(policy),
      request = this.#projection.requests.get(refId(ref));

    if (
      vault.deployment.family !== "ctvs2" ||
      !request ||
      request.policy !== vault.deployment.policy ||
      request.status !== "pending_escrow" ||
      !request.source.datum
    )
      throw new Error("no unspent recognized recovery source");

    return structuredClone({
      deployment: { ...vault.deployment, chainPoint: this.#point },
      source: {
        ...protectedMetadata(request.source, vault.deployment.policy, this.#network.networkId),
        datumCbor: request.source.datum,
      },
    });
  }

  /**
   * Diagnose an observed output at this vault without promoting it to a vault liability.
   * Recovery metadata and economic support are independent observations. Recognized
   * Requests can be returned from retained history even after consumption; use request()
   * for lifecycle or recoverySource() for a pending source. Missing output origin throws.
   */
  candidate(policy: string, ref: OutRef) {
    const vault = this.#vault(policy);
    const recognized = this.#projection.requests.get(refId(ref));
    const source = recognized?.source ?? this.#projection.utxos.get(refId(ref));

    if (
      !source ||
      getAddressDetails(source.address).paymentCredential?.hash !== vault.deployment.policy
    )
      throw new Error("no candidate at this vault in retained history");

    let recovery: Observation<unknown>;

    try {
      protectedMetadata(source, vault.deployment.policy, this.#network.networkId);

      if (!recognized) throw new Error("unknown or unsupported Request recovery envelope");

      recovery = known(recognized.recovery);
    } catch (error) {
      recovery = {
        status: "unsupported",
        reason: error instanceof Error ? error.message : String(error),
      };
    }

    return this.#response(vault, "request_candidate", {
      ref,
      source,
      recovery,
      economics: recognized
        ? this.request(policy, ref).data.requestValidation
        : { status: "unsupported", reason: "unrecognized recovery envelope" },
      vaultLiability: false,
      classification: recognized ? "recognized_recovery" : "unsupported_recovery",
    });
  }

  /**
   * Return only Claims installed by authenticated settlement lineage, including their
   * retained delivered flag. A funded lookalike at the Claim script is insufficient.
   * Delivery does not erase the record; rollback reconstructs its prior lifecycle.
   */
  claim(policy: string, ref: OutRef) {
    const vault = this.#vault(policy),
      record = this.#projection.claims.get(refId(ref));

    if (!record || record.claim.vaultPolicy !== vault.deployment.policy)
      throw new Error("output is not a Claim with authenticated settlement lineage");

    return this.#response(vault, "claim", record);
  }

  /**
   * Partition observed entitlement into free SHARE, redemption escrow, issued Claims,
   * pending deposit assets and fixed asset Claims without summing unlike categories.
   * Refund ownership, cancellation control and final receiver may name different users.
   * Results cover retained accepted history, not a separate wallet/provider inventory;
   * unsupported Requests are counted rather than assigned invented economic amounts.
   */
  ownership(policy: string, owner: Address) {
    const vault = this.#vault(policy),
      unit = `${vault.deployment.policy}.${NAMES.share}`;
    const freeShares = freeShareBalance(this.#projection, owner, unit);
    const {
      lockedRedemptionShares,
      pendingDepositAssets,
      unsupportedRequests,
      controlledRequests,
    } = pendingRequestOwnership(this.#projection, vault, owner);
    const { issuedUndeliveredShares, fixedAssetClaims } = undeliveredClaimOwnership(
      this.#projection,
      vault,
      owner,
      unit,
    );

    return this.#response(vault, "ownership", {
      freeShares,
      lockedRedemptionShares,
      issuedUndeliveredShares,
      pendingDepositAssets,
      fixedAssetClaims,
      unsupportedRequests,
      controlledRequests,
      pendingEntitlement: "refund_destination",
      scope: "accepted history since authenticated genesis",
    });
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
