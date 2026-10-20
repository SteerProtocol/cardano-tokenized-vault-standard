/** Test-only byte relay: all RPC replies come from the real Ogmios server; disconnections are explicit. */
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import WebSocket, { Server as WebSocketServer } from "ws";
import { closeServer } from "../../../../src/server.js";
import type { RelaySession } from "../../../support/evidence/ogmios-wire.js";

export class G1Relay {
  readonly sessions: RelaySession[] = [];
  readonly errors: string[] = [];
  readonly #upstream: string;
  readonly #http;
  readonly #sockets;
  readonly #links = new Set<WebSocket>();
  #blocked = false;
  #bytes = 0;

  constructor(upstream: string) {
    this.#upstream = upstream;
    this.#http = createServer((request, response) => {
      void this.#health(request, response);
    });
    this.#sockets = new WebSocketServer({ server: this.#http, maxPayload: 4000000 });
    this.#sockets.on("connection", (socket) => this.#connected(socket));
  }

  async start() {
    await new Promise<void>((resolve, reject) => {
      this.#http.once("error", reject);
      this.#http.listen(19007, "0.0.0.0", () => resolve());
    });
  }

  async #health(request: IncomingMessage, response: ServerResponse) {
    try {
      if (this.#blocked) throw new Error("intentional G1 source outage");

      assert.equal(request.url, "/health");

      const upstream = await fetch(`${this.#upstream}/health`, {
        signal: AbortSignal.timeout(5000),
      });

      response.writeHead(upstream.status, { "content-type": "application/json" });
      response.end(await upstream.text());
    } catch {
      response.writeHead(503);
      response.end();
    }
  }

  #connected(socket: WebSocket) {
    if (this.#blocked) return socket.terminate();

    const upstream = new WebSocket(this.#upstream.replace(/^http/, "ws"), { maxPayload: 4000000 });
    const session: RelaySession = { id: this.sessions.length, messages: [] };
    const queued: string[] = [];

    this.sessions.push(session);
    this.#links.add(upstream);
    socket.on("message", (bytes) => {
      const wire = bytes.toString();

      this.#record(session, "request", wire);

      if (upstream.readyState === WebSocket.OPEN) upstream.send(wire);
      else {
        assert.ok(queued.length < 4);
        queued.push(wire);
      }
    });
    upstream.on("open", () => {
      for (const wire of queued.splice(0)) upstream.send(wire);
    });
    upstream.on("message", (bytes) => {
      const wire = bytes.toString();

      this.#record(session, "response", wire);

      if (socket.readyState === WebSocket.OPEN) socket.send(wire);
    });
    upstream.on("error", (error) => {
      if (!this.#blocked) this.errors.push(error.message);

      socket.terminate();
    });
    upstream.on("close", () => socket.terminate());
    socket.on("error", () => upstream.terminate());
    socket.on("close", () => {
      this.#links.delete(upstream);
      upstream.terminate();
    });
  }

  #record(session: RelaySession, direction: "request" | "response", wire: string) {
    this.#bytes += Buffer.byteLength(wire);
    assert.ok(this.#bytes <= 32000000 && session.messages.length < 2000);
    session.messages.push({ direction, wire });
  }

  block() {
    this.#blocked = true;

    for (const socket of this.#sockets.clients) socket.terminate();

    for (const socket of this.#links) socket.terminate();
  }

  resume() {
    this.#blocked = false;
  }

  async close() {
    this.block();
    await new Promise<void>((resolve) => this.#sockets.close(() => resolve()));
    await closeServer(this.#http);
  }
}
