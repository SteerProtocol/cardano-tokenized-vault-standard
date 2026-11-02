/** Minimal synthetic Ogmios transport. It tests the real official client, not ledger or consensus acceptance. */
import { createServer } from "node:http";
import type WebSocket from "ws";
import { Server as WebSocketServer } from "ws";
import type { IndexerConfig } from "../../src/config.js";
import { object } from "../../src/config.js";
import { closeServer } from "../../src/server.js";

export async function sourceServer(config: IndexerConfig, magic = config.network.networkMagic) {
  const http = createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ lastTipUpdate: config.genesisStart, networkSynchronization: 1 }));
  });

  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(0, "127.0.0.1", () => {
      http.removeListener("error", reject);
      resolve();
    });
  });

  const sockets = new WebSocketServer({ server: http });
  const events: unknown[] = [];
  let tip: unknown = {
    slot: Number(config.intersection.slot),
    id: config.intersection.blockHash,
    height: 0,
  };
  let pending: { socket: WebSocket; request: Record<string, unknown> } | null = null;
  let respondToTip = true;
  let tipQueries = 0;

  const reply = (socket: WebSocket, request: Record<string, unknown>, result: unknown) => {
    socket.send(JSON.stringify({ jsonrpc: "2.0", method: request.method, id: request.id, result }));
  };

  const flush = () => {
    if (!pending || events.length === 0) return;

    const event = events.shift();
    const raw = object(event, "synthetic chain event");

    tip = raw.tip;
    reply(pending.socket, pending.request, event);
    pending = null;
  };

  sockets.on("connection", (socket) => {
    socket.on("message", (bytes) => {
      const request = object(JSON.parse(bytes.toString()), "synthetic request");

      if (request.method === "queryNetwork/genesisConfiguration") {
        reply(socket, request, {
          era: "shelley",
          networkMagic: magic,
          network: "testnet",
          startTime: config.genesisStart,
        });
      } else if (request.method === "queryNetwork/tip") {
        tipQueries++;

        if (respondToTip) reply(socket, request, tip);
      } else if (request.method === "findIntersection") {
        const params = object(request.params, "intersection params");
        const points = params.points;

        if (!Array.isArray(points)) throw new Error("missing intersection candidates");

        reply(socket, request, { intersection: points[0], tip });
      } else if (request.method === "nextBlock") {
        pending = { socket, request };
        flush();
      }
    });
  });

  const address = http.address();

  if (!address || typeof address === "string") throw new Error("missing source port");

  return {
    url: `http://127.0.0.1:${address.port}`,
    setTip: (value: unknown) => {
      tip = value;
    },
    silenceTip: () => {
      respondToTip = false;
    },
    resumeTip: () => {
      respondToTip = true;
    },
    get tipQueries() {
      return tipQueries;
    },
    push: (event: unknown) => {
      events.push(event);
      flush();
    },
    disconnect: () => {
      for (const socket of sockets.clients) socket.terminate();

      pending = null;
    },
    close: async () => {
      for (const socket of sockets.clients) socket.terminate();

      await new Promise<void>((resolve) => sockets.close(() => resolve()));
      await closeServer(http);
    },
  };
}
