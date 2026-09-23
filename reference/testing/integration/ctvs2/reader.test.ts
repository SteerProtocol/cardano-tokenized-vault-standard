/** Replays accepted signed emulator transactions through the reader, including a synthetic competing branch. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildBatchPlan, buildDeliverPlan, buildRefundPlan } from "@ctvs/ctvs2";
import { type AcceptedBlock, type ReviewedBuild, VaultReader } from "@ctvs/integration";
import { NAMES, refId } from "@ctvs/protocol";
import { validatorToAddress } from "@lucid-evolution/lucid";
import { expect, it } from "vitest";
import { findValidator, readBlueprint, referenceRoot, sha256 } from "../../../tools/lib/project.js";
import { fundRequest } from "../../fixtures/requests.js";
import { createVault, type VaultFixture } from "../../fixtures/vault.js";
import { asRef, protocolValue } from "../../ledger/serialization.js";

/**
 * Build an accepted-history adapter around the scenario's recorded signed CBOR.
 * Blocks are local evidence fixtures with explicit parents, not a node chain feed;
 * the reader must still establish vault identity from genesis within that history.
 */
function createReaderReplay(vault: VaultFixture) {
  const blueprintPath = join(referenceRoot, "artifacts/ctvs2/blueprint.json");
  const blueprint = readBlueprint(blueprintPath);
  const reviewed: ReviewedBuild = {
    family: "ctvs2",
    buildId: sha256(readFileSync(blueprintPath)),
    vaultTemplate: findValidator(blueprint, "vault.vault.spend").compiledCode,
    config: {
      type: "PlutusV3",
      script: findValidator(blueprint, "config_lock.config_lock.spend").compiledCode,
    },
    claim: {
      type: "PlutusV3",
      script: findValidator(blueprint, "claim.claim_guard.spend").compiledCode,
    },
  };
  const origin = { slot: 0n, blockHash: "00".repeat(32) };
  // Explicit identifiers for this isolated emulator, not claims about a Cardano network.
  const network = {
    name: vault.deployment.network,
    networkId: 0 as const,
    networkMagic: 42,
    genesisHash: sha256(Buffer.from("CTVS/local-reader-emulator-genesis")),
    domain: vault.terms.networkDomain,
  };
  const reader = new VaultReader(network, [reviewed], origin);
  const blocks: { stage: string; block: AcceptedBlock }[] = [];

  const feed = (stage: string) => {
    const record = vault.recorder.accepted.find((entry) => entry.stage === stage);

    if (!record) throw new Error(`Missing signed accepted transaction ${stage}`);

    // One synthetic local block per actual accepted signed transaction makes rollback cuts explicit.
    const block: AcceptedBlock = {
      parent: reader.chainPoint,
      point: {
        slot: reader.chainPoint.slot + 1n,
        blockHash: sha256(Buffer.from(`CTVS/local-reader-block/${stage}/${record.txId}`)),
      },
      transactions: [record.signedCbor],
    };

    reader.rollForward(block);
    blocks.push({ stage, block });

    return block;
  };

  const share = `${vault.policy}.${NAMES.share}`;

  return { vault, reviewed, origin, network, reader, blocks, feed, share };
}

type ReaderReplay = ReturnType<typeof createReaderReplay>;

async function assertGenesis({ vault, reviewed, network, reader, feed, share }: ReaderReplay) {
  feed("publish");
  expect(() => reader.discover(share)).toThrow(/authenticated genesis/);

  const genesisBlock = feed("genesis");
  const genesisSnapshot = reader.discover(share);

  expect(genesisSnapshot).toMatchObject({
    schema: "CTVS-INTEGRATION-0.6",
    network,
    implementation: { buildId: reviewed.buildId, family: "ctvs2", profile: 0, wire: 2 },
    verification: {
      independentLedgerValidation: false,
      consensusSource: "trusted_accepted_block_feed",
    },
    data: {
      backingAssets: { status: "known", value: 0n },
      economicSupply: { status: "known", value: 0n },
    },
  });
  expect(genesisSnapshot.vault.configRef).toEqual(vault.deployment.configRef);
  expect(reader.context(vault.policy).stateInput).toEqual(await vault.stateInput());

  const quote = reader.quote(vault.policy, "deposit", 101_000_000n);

  expect(quote.data).toMatchObject({
    pricing: "indicative_until_settlement",
    result: { status: "known", value: { shares: 100_000_000n, fee: 1_000_000n } },
    constructionMaximum: { status: "unknown" },
    availability: { status: "known", value: true },
  });

  return genesisBlock;
}

async function fundReaderRequest({ vault, reader, feed }: ReaderReplay) {
  const { request, utxo } = await fundRequest(
    vault,
    "deposit",
    101_000_000n,
    100_000_000n,
    "-reader",
  );
  const requestRef = asRef(utxo);
  const requestBlock = feed("request-deposit-reader");
  const pending = reader.request(vault.policy, requestRef);

  expect(pending.data.status).toBe("pending_escrow");
  expect(pending.data.requestValidation.status).toBe("known");
  expect(pending.data.recoveryAvailability.status).toBe("known");
  expect(reader.ownership(vault.policy, vault.receiver.address).data).toMatchObject({
    freeShares: 0n,
    pendingDepositAssets: 101_000_000n,
    issuedUndeliveredShares: 0n,
    lockedRedemptionShares: 0n,
    fixedAssetClaims: 0n,
  });

  const stateBefore = await vault.stateInput();
  // Public mutable fields of the pinned isolated Emulator form a local fork checkpoint.
  // Restoring these fields tests another accepted local history, not cardano-node rollback.
  const checkpoint = structuredClone({
    ledger: vault.emulator.ledger,
    mempool: vault.emulator.mempool,
    chain: vault.emulator.chain,
    blockHeight: vault.emulator.blockHeight,
    slot: vault.emulator.slot,
    time: vault.emulator.time,
    protocolParameters: vault.emulator.protocolParameters,
    datumTable: vault.emulator.datumTable,
    treasury: vault.emulator.treasury,
    transactionHistory: vault.emulator.transactionHistory,
  });

  return { request, utxo, requestRef, requestBlock, stateBefore, checkpoint };
}

type PendingRequest = Awaited<ReturnType<typeof fundReaderRequest>>;

async function settleReaderRequest(
  { vault, reader, feed }: ReaderReplay,
  { request, utxo, requestRef, stateBefore }: PendingRequest,
) {
  const batch = buildBatchPlan({
    ...(await vault.asyncContext()),
    requests: [{ input: await vault.protectedInput(utxo) }],
    rewardKey: vault.userKey,
    rewardTopup: 2_000_000n,
    validity: {
      lowerPosixMs: BigInt(vault.emulator.now()),
      upperPosixMs: request.recovery.deadlinePosixMs,
    },
  });
  const settledId = await vault.submit("reader-settle", batch);
  const claimUtxo = await vault.output(settledId, 1);
  const claimRef = asRef(claimUtxo);
  const settlementBlock = feed("reader-settle");

  expect(reader.request(vault.policy, requestRef).data.status).toBe("claimable");
  expect(reader.claim(vault.policy, claimRef).data).toMatchObject({
    delivered: false,
    request: refId(requestRef),
    claim: { requestRef, stateRef: stateBefore.ref, economicQuantity: 100_000_000n },
  });
  expect(reader.snapshot(vault.policy).data).toMatchObject({
    backingAssets: { status: "known", value: 100_000_000n },
    economicSupply: { status: "known", value: 100_000_000n },
    excludedFees: { status: "known", value: 1_000_000n },
  });
  expect(reader.ownership(vault.policy, vault.receiver.address).data).toMatchObject({
    freeShares: 0n,
    pendingDepositAssets: 0n,
    issuedUndeliveredShares: 100_000_000n,
  });

  const stateAfter = await vault.stateInput();
  const context = await vault.asyncContext();

  return { claimUtxo, claimRef, settlementBlock, stateAfter, context };
}

type SettledRequest = Awaited<ReturnType<typeof settleReaderRequest>>;

async function deliverReaderClaim(
  { vault, reader, feed }: ReaderReplay,
  { claimUtxo, claimRef, stateAfter, context }: SettledRequest,
  requestRef: PendingRequest["requestRef"],
) {
  await vault.submit(
    "reader-deliver",
    buildDeliverPlan({
      deployment: context.deployment,
      claims: [await vault.protectedInput(claimUtxo)],
    }),
  );

  const deliveryBlock = feed("reader-deliver");

  expect(reader.request(vault.policy, requestRef).data.status).toBe("delivered");
  expect(reader.claim(vault.policy, claimRef).data.delivered).toBe(true);
  expect(reader.ownership(vault.policy, vault.receiver.address).data).toMatchObject({
    freeShares: 100_000_000n,
    issuedUndeliveredShares: 0n,
    pendingDepositAssets: 0n,
  });
  expect(reader.context(vault.policy).stateInput).toEqual(stateAfter);

  return deliveryBlock;
}

async function rejectReaderLookalikes(
  { vault, reviewed, reader, feed }: ReaderReplay,
  { claimUtxo }: SettledRequest,
  requestRef: PendingRequest["requestRef"],
): Promise<void> {
  const configUtxo = await vault.emulator.getUtxoByUnit(vault.idUnit);

  if (!configUtxo.datum || !claimUtxo.datum || !reviewed.claim)
    throw new Error("Missing authenticated fixture datum");

  const claimAddress = validatorToAddress("Custom", reviewed.claim);
  const extras = [
    {
      address: vault.configAddress,
      value: { ada: 10_000_000n },
      datum: { kind: "inline" as const, cbor: configUtxo.datum },
      referenceScript: null,
    },
    {
      address: claimAddress,
      value: protocolValue(claimUtxo.assets),
      datum: { kind: "inline" as const, cbor: claimUtxo.datum },
      referenceScript: null,
    },
  ];
  const authorization = await vault.authorize(null, extras);
  const lookalikeId = await vault.recorder.submit(
    "reader-lookalikes",
    vault.lucid
      .newTx()
      .pay.ToAddressWithData(
        vault.configAddress,
        { kind: "inline", value: configUtxo.datum },
        { lovelace: 10_000_000n },
      )
      .pay.ToAddressWithData(
        claimAddress,
        { kind: "inline", value: claimUtxo.datum },
        claimUtxo.assets,
      ),
    { plan: null, authorization },
  );

  feed("reader-lookalikes");
  expect(reader.snapshot(vault.policy).vault.configRef).toEqual(vault.deployment.configRef);
  expect(() => reader.claim(vault.policy, { txId: lookalikeId, index: 1n })).toThrow(
    /authenticated settlement lineage/,
  );
  expect(reader.request(vault.policy, requestRef).data.status).toBe("delivered");
  expect(reader.ownership(vault.policy, vault.receiver.address).data.issuedUndeliveredShares).toBe(
    0n,
  );
}

/**
 * Reverse delivery first, then settlement, and check entitlement at both boundaries.
 * Replaying a removed block must restore its effects exactly; rolling back farther
 * must erase the Claim's origin rather than leave a stale but apparently valid record.
 */
function rollbackReaderSettlement(
  { vault, reader }: ReaderReplay,
  { requestBlock, requestRef, stateBefore }: PendingRequest,
  { settlementBlock, claimRef, stateAfter }: SettledRequest,
  deliveryBlock: AcceptedBlock,
): void {
  reader.rollBackward(settlementBlock.point);
  expect(reader.chainPoint).toEqual(settlementBlock.point);
  expect(reader.request(vault.policy, requestRef).data).toMatchObject({
    status: "claimable",
    completion: null,
  });
  expect(reader.claim(vault.policy, claimRef).data.delivered).toBe(false);
  expect(reader.ownership(vault.policy, vault.receiver.address).data).toMatchObject({
    freeShares: 0n,
    issuedUndeliveredShares: 100_000_000n,
    pendingDepositAssets: 0n,
  });
  expect(reader.context(vault.policy).stateInput).toEqual(stateAfter);
  reader.rollForward(deliveryBlock);
  expect(reader.request(vault.policy, requestRef).data.status).toBe("delivered");

  reader.rollBackward(requestBlock.point);
  expect(reader.request(vault.policy, requestRef).data).toMatchObject({
    status: "pending_escrow",
    settlement: null,
    completion: null,
  });
  expect(() => reader.claim(vault.policy, claimRef)).toThrow(/authenticated settlement lineage/);
  expect(reader.context(vault.policy).stateInput).toEqual(stateBefore);
  expect(reader.ownership(vault.policy, vault.receiver.address).data).toMatchObject({
    freeShares: 0n,
    issuedUndeliveredShares: 0n,
    pendingDepositAssets: 101_000_000n,
  });
}

/**
 * Restore the Emulator to the pre-settlement checkpoint to construct a real competing
 * spend of the same Request. Both ledger state and reader history must change branches;
 * a reader-only rollback could otherwise query UTxOs already spent by the old branch.
 */
async function cancelCompetingBranch(
  { vault, reader, feed }: ReaderReplay,
  { checkpoint, requestRef, request, stateBefore }: PendingRequest,
  { context, claimRef }: SettledRequest,
): Promise<void> {
  Object.assign(vault.emulator, structuredClone(checkpoint));

  const restored = await vault.output(requestRef.txId, Number(requestRef.index));

  await vault.submit(
    "reader-replacement-cancel",
    buildRefundPlan({
      deployment: context.deployment,
      source: await vault.protectedInput(restored),
      mode: "cancel",
      validity: {
        lowerPosixMs: BigInt(vault.emulator.now()),
        upperPosixMs: request.recovery.deadlinePosixMs,
      },
    }),
  );
  feed("reader-replacement-cancel");
  expect(reader.request(vault.policy, requestRef).data).toMatchObject({
    status: "refunded",
    settlement: null,
  });
  expect(reader.request(vault.policy, requestRef).data.completion?.txId).toBe(
    vault.recorder.accepted.find((entry) => entry.stage === "reader-replacement-cancel")?.txId,
  );
  expect(reader.ownership(vault.policy, vault.receiver.address).data).toMatchObject({
    freeShares: 0n,
    issuedUndeliveredShares: 0n,
    pendingDepositAssets: 0n,
  });
  expect(reader.context(vault.policy).stateInput).toEqual(stateBefore);
  expect(() => reader.claim(vault.policy, claimRef)).toThrow(/authenticated settlement lineage/);
}

// These phases share one history so rollback and replacement are checked against the same funded Request.
it("replays signed accepted history, authenticates origins, and reverses ownership across a local competing branch", async () => {
  const vault = await createVault("ctvs2", "native", "authenticated-reader-replay");
  const replay = createReaderReplay(vault);
  const { reader, network, reviewed, blocks, origin, share } = replay;
  const genesisBlock = await assertGenesis(replay);
  const pending = await fundReaderRequest(replay);
  const settled = await settleReaderRequest(replay, pending);
  const deliveryBlock = await deliverReaderClaim(replay, settled, pending.requestRef);

  await rejectReaderLookalikes(replay, settled, pending.requestRef);
  rollbackReaderSettlement(replay, pending, settled, deliveryBlock);
  await cancelCompetingBranch(replay, pending, settled);

  const { requestRef, requestBlock } = pending;

  vault.recorder.write("reader-replay", {
    network,
    reviewedBuildId: reviewed.buildId,
    blockPoints: "synthetic one-block-per-accepted-transaction test points; no node rollback",
    forkPoint: requestBlock.point,
    blocks,
    replacement: reader.request(vault.policy, requestRef),
    final: reader.snapshot(vault.policy),
    ownership: reader.ownership(vault.policy, vault.receiver.address),
  });
  vault.recorder.finish();
  reader.rollBackward(genesisBlock.point);
  expect(() => reader.request(vault.policy, requestRef)).toThrow(/accepted origin/);
  reader.rollBackward(origin);
  expect(() => reader.discover(share)).toThrow(/authenticated genesis/);
});
