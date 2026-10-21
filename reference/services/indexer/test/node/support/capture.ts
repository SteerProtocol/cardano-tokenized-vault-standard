/** Retain actual Ogmios transaction-bearing blocks, without reconstructing their CBOR. */
import { createChainSynchronizationClient, createInteractionContext } from "@cardano-ogmios/client";
import type { AcceptedBlock } from "@ctvs/integration";
import type { ChainPoint } from "@ctvs/planning";
import { acceptedBlock, chainPoint } from "../../../src/chain/ogmios.js";
import type { IndexerConfig } from "../../../src/config.js";
import { withCleanup } from "../../support/cleanup.js";
import { write } from "./environment.js";

export async function capture(config: IndexerConfig, directory: string, label = "ogmios-events") {
  let closed = false;
  const failures: unknown[] = [];
  const events: (
    | { direction: "forward"; block: AcceptedBlock; tip: ChainPoint }
    | { direction: "backward"; from: ChainPoint; point: ChainPoint; tip: ChainPoint }
  )[] = [];
  const rollbacks: { from: ChainPoint; point: ChainPoint; tip: ChainPoint }[] = [];
  const observed = new Map<string, { cbor: string; slot: bigint; blockHash: string }>();
  const context = await createInteractionContext(
    (error) => {
      failures.push(error);
    },
    () => {},
    {
      connection: {
        address: {
          http: config.sources.ogmios,
          webSocket: config.sources.ogmios.replace(/^http/, "ws"),
        },
      },
    },
  );

  try {
    let parent = config.intersection;
    const client = await createChainSynchronizationClient(
      context,
      {
        async rollForward({ block, tip }, next) {
          try {
            const accepted = acceptedBlock(block, parent);

            events.push({ direction: "forward", block: accepted, tip: chainPoint(tip) });

            if (accepted.transactions.length) {
              write(directory, `ogmios-block-${block.id}`, { block, tip });

              for (const tx of ("transactions" in block ? block.transactions : []) ?? [])
                if (tx.cbor) observed.set(tx.id, { cbor: tx.cbor, ...accepted.point });
            }

            parent = accepted.point;
            next();
          } catch (error) {
            failures.push(error);
          }
        },
        async rollBackward(response, next) {
          const { point, tip } = response;

          write(directory, `${label}-backward-${events.length}`, response);

          if (point === "origin") failures.push(new Error("G0 rolled before its bootstrap"));
          else {
            const event = { from: parent, point: chainPoint(point), tip: chainPoint(tip) };

            events.push({ direction: "backward", ...event });

            if (event.point.slot < parent.slot) rollbacks.push(event);

            parent = event.point;
            next();
          }
        },
      },
      { sequential: true },
    );

    await client.resume(
      [{ slot: Number(config.intersection.slot), id: config.intersection.blockHash }],
      1,
    );

    return {
      observed,
      failures,
      events,
      rollbacks,
      close: async () => {
        if (closed) return;

        closed = true;
        await withCleanup(async (cleanup) => {
          cleanup.defer(() => context.socket.terminate());
          cleanup.defer(async () => {
            if (context.socket.readyState === 1) await client.shutdown();
          });
          write(directory, label, events);
        });
      },
    };
  } catch (error) {
    context.socket.terminate();

    throw error;
  }
}
