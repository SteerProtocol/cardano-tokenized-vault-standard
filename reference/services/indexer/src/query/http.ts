/** Bounded query bodies are fully validated before the synchronous committed reader callback begins. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { dispatchRead } from "@ctvs/integration";
import {
  decodeReadRequest,
  encodeQueryResponse,
  parseVaultPolicy,
  QUERY_BUDGET,
  QUERY_VERSION,
  QueryError,
} from "@ctvs/integration/query";
import type { Runner } from "../runner.js";

async function body(request: IncomingMessage): Promise<unknown> {
  if (request.headers["content-type"]?.split(";")[0]?.trim() !== "application/json")
    throw new QueryError("INVALID_REQUEST", "content-type must be application/json", 415);

  try {
    const bytes = await receiveBody(request);

    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof QueryError) throw error;

    throw new QueryError("INVALID_REQUEST", "body must be JSON");
  }
}

function receiveBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts: Buffer[] = [];

    const done = (error?: unknown) => {
      clearTimeout(timer);
      request.off("data", chunk).off("end", end).off("error", done).off("aborted", aborted);

      if (error) {
        request.pause();
        reject(error);
      } else resolve(Buffer.concat(parts));
    };

    const chunk = (part: Buffer) => {
      size += part.length;

      if (size > QUERY_BUDGET.bodyBytes)
        done(new QueryError("QUERY_LIMIT", "request body exceeds budget", 413));
      else parts.push(part);
    };

    const end = () => done();

    const aborted = () => done(new QueryError("INVALID_REQUEST", "request was aborted"));

    const timer = setTimeout(
      () => done(new QueryError("QUERY_LIMIT", "request body timed out", 408)),
      QUERY_BUDGET.timeoutMs,
    );

    timer.unref();

    if (Number(request.headers["content-length"]) > QUERY_BUDGET.bodyBytes) {
      done(new QueryError("QUERY_LIMIT", "request body exceeds budget", 413));

      return;
    }

    request.on("data", chunk).once("end", end).once("error", done).once("aborted", aborted);
  });
}

function reply(response: ServerResponse, value: string): void {
  if (Buffer.byteLength(value) > QUERY_BUDGET.responseBytes)
    throw new QueryError("QUERY_LIMIT", "response exceeds budget", 413);

  response.end(value);
}

export function queryFailure(response: ServerResponse, error: unknown): void {
  if (response.destroyed || response.writableEnded) return;

  const failure =
    error instanceof QueryError
      ? error
      : error instanceof RangeError
        ? new QueryError("INVALID_REQUEST", "quantity is outside the supported domain")
        : new QueryError("INTERNAL_ERROR", "query failed", 500);

  response.statusCode = failure.status;

  if (failure.code === "QUERY_LIMIT") response.setHeader("Connection", "close");

  response.end(
    JSON.stringify({
      apiVersion: QUERY_VERSION,
      error: { code: failure.code, message: failure.message },
    }),
  );
}

function ready(runner: Runner) {
  const status = runner.status();

  if (!status.readerReady)
    throw new QueryError("READER_NOT_READY", "reader has not reconciled its current branch", 503);

  return status;
}

export async function queryHttp(
  request: IncomingMessage,
  response: ServerResponse,
  runner: Runner,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://indexer.local");
  const match = /^\/v1\/vaults\/([a-fA-F0-9]{56})\/read$/.exec(url.pathname);

  if (match) {
    if (request.method !== "POST")
      throw new QueryError("INVALID_REQUEST", "read route requires POST", 405);

    if (url.search) throw new QueryError("INVALID_REQUEST", "read options belong in the body");

    const parsed = decodeReadRequest(await body(request));
    const status = ready(runner);
    const policy = parseVaultPolicy(match[1]?.toLowerCase());
    const result = runner.read((reader) => dispatchRead(reader, policy, parsed, status));

    reply(response, encodeQueryResponse(result));

    return;
  }

  if (url.pathname === "/v1/discover") {
    if (request.method !== "GET")
      throw new QueryError("INVALID_REQUEST", "discovery requires GET", 405);

    const share = url.searchParams.get("share") ?? "";

    if (url.searchParams.size !== 1 || !/^[a-f0-9]{56}\.5348415245$/.test(share))
      throw new QueryError("INVALID_REQUEST", "exact SHARE identity required");

    const status = ready(runner);
    const policy = share.split(".")[0] ?? "";

    reply(
      response,
      encodeQueryResponse(
        runner.read((reader) =>
          dispatchRead(
            reader,
            policy,
            { apiVersion: QUERY_VERSION, queries: { snapshot: true } },
            status,
          ),
        ),
      ),
    );

    return;
  }

  throw new QueryError("NOT_FOUND", "query route not found", 404);
}
