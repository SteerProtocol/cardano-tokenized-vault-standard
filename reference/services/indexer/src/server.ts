/** Operational endpoints and the versioned read-only query transport share one daemon. */
import { createServer, type Server } from "node:http";
import type { IndexerConfig } from "./config.js";
import { queryFailure, queryHttp } from "./query/http.js";
import type { Runner } from "./runner.js";
import { encode } from "./storage/journal.js";

export async function statusServer(config: IndexerConfig, runner: Runner): Promise<Server> {
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.setHeader("Cache-Control", "no-store");

    if (request.url?.startsWith("/v1/")) {
      void queryHttp(request, response, runner).catch((error: unknown) =>
        queryFailure(response, error),
      );

      return;
    }

    if (request.method !== "GET") {
      response.writeHead(405).end(encode({ error: "method_not_allowed" }));

      return;
    }

    const path = request.url?.split("?")[0];

    if (path === "/health/live") {
      response.end(encode({ alive: true }));

      return;
    }

    if (path === "/status" || path === "/health/ready") {
      try {
        const status = runner.status();

        response.statusCode = path === "/health/ready" && !status.readerReady ? 503 : 200;
        response.end(encode(status));
      } catch {
        response.writeHead(503).end(encode({ error: "status_unavailable" }));
      }

      return;
    }

    response.writeHead(404).end(encode({ error: "route_not_implemented" }));
  });

  server.requestTimeout = 10000;
  server.headersTimeout = 10000;

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.http.port, config.http.host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  return server;
}

export async function closeServer(server: Server): Promise<void> {
  server.closeIdleConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
