/** Official Ogmios client with one outstanding block request and explicit intersection reconciliation. */
import { setTimeout as delay } from "node:timers/promises";
import {
  createChainSynchronizationClient,
  createInteractionContext,
  type InteractionContext,
  JSONRPCError,
  LedgerStateQuery,
  type Schema,
} from "@cardano-ogmios/client";
import type { AcceptedBlock } from "@ctvs/integration";
import { readAcceptedTransaction } from "@ctvs/integration";
import type { ChainPoint } from "@ctvs/planning";
import { hex, type IndexerConfig, object } from "../config.js";
import type { Runner } from "../runner.js";

export class ChainDataError extends Error {}
class RequestTimeoutError extends Error {}

function fatalSourceError(error: unknown): boolean {
  return (
    error instanceof ChainDataError ||
    (error instanceof JSONRPCError &&
      !(error.code === -32000 && error.message === "Connection closed"))
  );
}

/** JSON numeric slots are accepted only when exact; the client may decode large integers to bigint. */
export function chainPoint(raw: Schema.Point | Schema.Tip | "origin"): ChainPoint {
  if (raw === "origin")
    throw new ChainDataError("origin requires an earlier explicit bootstrap design");

  if (
    (typeof raw.slot !== "bigint" && !Number.isSafeInteger(raw.slot)) ||
    raw.slot < 0 ||
    BigInt(raw.slot) > BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw new ChainDataError("source slot is not an exact nonnegative integer");

  try {
    return { slot: BigInt(raw.slot), blockHash: hex(raw.id, 32, "source block id") };
  } catch {
    throw new ChainDataError("source block id has invalid hex");
  }
}

/** Retain every transaction in order and check its bytes against the node's JSON identity/outcome. */
export function acceptedBlock(block: Schema.Block, parent: ChainPoint): AcceptedBlock {
  if (block.type === "ebb")
    throw new ChainDataError("bootstrap must follow Byron epoch-boundary blocks");

  if (block.ancestor !== parent.blockHash)
    throw new ChainDataError("block ancestor disagrees with reader cursor");

  const transactions = (block.transactions ?? []).map((transaction) => {
    if (!transaction.cbor || !/^(?:[a-fA-F0-9]{2})+$/.test(transaction.cbor))
      throw new ChainDataError(
        "missing complete transaction CBOR; enable --include-transaction-cbor",
      );

    const decoded = readAcceptedTransaction(transaction.cbor);

    if (decoded.id !== transaction.id || decoded.valid !== (transaction.spends === "inputs"))
      throw new ChainDataError("transaction CBOR disagrees with source identity or validity");

    return transaction.cbor;
  });

  return { parent, point: chainPoint(block), transactions };
}

/** Cross-check served Shelley identity with the exact local genesis file already hashed by configuration loading. */
export function verifyGenesis(raw: unknown, config: IndexerConfig): void {
  const genesis = object(raw, "served genesis");

  if (
    genesis.networkMagic !== config.network.networkMagic ||
    genesis.network !== (config.network.networkId === 1 ? "mainnet" : "testnet") ||
    Date.parse(String(genesis.startTime)) !== Date.parse(config.genesisStart)
  )
    throw new ChainDataError("Ogmios network does not match pinned Shelley genesis");
}

/** Timeout an official-client setup operation; a late-created connection is disposed by the caller. */
async function bounded<T>(
  operation: Promise<T>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<T> {
  const abort = new AbortController();

  try {
    return await Promise.race([
      operation,
      delay(timeoutMs, undefined, { signal: AbortSignal.any([signal, abort.signal]) }).then(() => {
        throw new RequestTimeoutError("Ogmios request timed out");
      }),
    ]);
  } finally {
    abort.abort();
  }
}

/** The official client types expose browser-compatible sockets; Node sockets also support immediate termination. */
function closeContext(context: InteractionContext | undefined): void {
  if (!context) return;

  const socket = context.socket;

  if ("terminate" in socket && typeof socket.terminate === "function") socket.terminate();
  else socket.close();
}

async function connect(
  config: IndexerConfig,
  signal: AbortSignal,
  stop: () => void,
  opened: (context: InteractionContext) => void,
): Promise<InteractionContext> {
  const opening = createInteractionContext(stop, stop, {
    connection: {
      address: {
        http: config.sources.ogmios,
        webSocket: config.sources.ogmios.replace(/^http/, "ws"),
      },
      maxPayload: config.limits.maxBlockBytes * 4,
    },
  }).then((context) => {
    opened(context);

    return context;
  });
  const context = await bounded(opening, config.limits.requestTimeoutMs, signal).catch(
    (error: unknown) => {
      // The SDK health/handshake promise has no abort API. Stop on timeout instead of accumulating pending attempts.
      if (error instanceof RequestTimeoutError)
        throw new ChainDataError("Ogmios connection setup timed out; process restart required");

      throw error;
    },
  );
  const genesis = await bounded(
    LedgerStateQuery.genesisConfiguration(context, "shelley"),
    config.limits.requestTimeoutMs,
    signal,
  );

  verifyGenesis(genesis, config);

  return context;
}

/** A pending nextBlock can legitimately wait forever. An independent query detects a silent or lagging connection. */
async function watchTip(
  config: IndexerConfig,
  context: InteractionContext,
  runner: Runner,
  signal: AbortSignal,
  ended: (error?: unknown) => void,
): Promise<void> {
  try {
    while (!signal.aborted) {
      await delay(config.limits.requestTimeoutMs, undefined, { signal });

      const before = runner.status();
      const tip = chainPoint(
        await bounded(LedgerStateQuery.networkTip(context), config.limits.requestTimeoutMs, signal),
      );
      const after = runner.status();

      if (signal.aborted) return;

      // A query initiated on the old branch or before a forward event cannot certify the new view.
      if (
        before.recoveryGeneration !== after.recoveryGeneration ||
        before.readerHead.blockHash !== after.readerHead.blockHash
      )
        continue;

      if (!runner.observeTip(tip)) {
        ended();

        return;
      }
    }
  } catch (error) {
    if (!signal.aborted) ended(error);
  }
}

async function session(config: IndexerConfig, runner: Runner, signal: AbortSignal): Promise<void> {
  let context: InteractionContext | undefined;
  let abandoned = false;
  let fatal: unknown;
  const monitoring = new AbortController();
  let heartbeat = Promise.resolve();

  let finish: () => void = () => {};

  const ended = new Promise<void>((resolve) => {
    finish = resolve;
  });

  let initialized: () => void = () => {};

  const ready = new Promise<void>((resolve) => {
    initialized = resolve;
  });

  const stop = () => {
    abandoned = true;
    closeContext(context);
    finish();
  };

  signal.addEventListener("abort", stop, { once: true });

  try {
    const connection = await connect(config, signal, stop, (connected) => {
      context = connected;

      if (abandoned || signal.aborted) closeContext(connected);
    });

    const handle = async (action: () => void, next: () => void): Promise<void> => {
      await ready;

      if (signal.aborted || abandoned) return;

      try {
        action();
        next();
      } catch (error) {
        fatal = error;
        runner.fail(error);
        stop();
      }
    };

    const client = await createChainSynchronizationClient(
      connection,
      {
        rollForward: (response, next) =>
          handle(() => {
            runner.forward(
              acceptedBlock(response.block, runner.status().readerHead),
              chainPoint(response.tip),
            );
          }, next),
        rollBackward: (response, next) =>
          handle(() => {
            runner.backward(chainPoint(response.point), chainPoint(response.tip));
          }, next),
      },
      { sequential: true },
    );
    const result = await bounded(
      client.resume(
        runner.intersections().map((point) => ({
          id: point.blockHash,
          slot: Number(point.slot),
        })),
        1,
      ),
      config.limits.requestTimeoutMs,
      signal,
    );

    runner.intersect(chainPoint(result.intersection), chainPoint(result.tip));
    initialized();
    heartbeat = watchTip(
      config,
      connection,
      runner,
      AbortSignal.any([signal, monitoring.signal]),
      (error) => {
        if (fatalSourceError(error)) {
          fatal = error;
          runner.fail(error);
        } else runner.disconnect();

        stop();
      },
    );
    await ended;

    if (fatal)
      throw new ChainDataError(fatal instanceof Error ? fatal.message : "chain event failed");
  } finally {
    abandoned = true;
    monitoring.abort();
    initialized();
    signal.removeEventListener("abort", stop);
    closeContext(context);
    await heartbeat;
  }
}

/** Transport failures retry; malformed history, identity mismatch or durable-reader failure stop the service. */
export async function synchronize(
  config: IndexerConfig,
  runner: Runner,
  signal: AbortSignal,
): Promise<void> {
  while (!signal.aborted) {
    try {
      await session(config, runner, signal);
    } catch (error) {
      if (signal.aborted) return;

      if (fatalSourceError(error) || runner.status().phase === "failed") {
        runner.fail(error);

        throw error;
      }
    }

    runner.disconnect();

    try {
      await delay(config.limits.reconnectDelayMs, undefined, { signal });
    } catch {
      return;
    }
  }
}
