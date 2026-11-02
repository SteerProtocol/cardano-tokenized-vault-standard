/** Slow, aborted, malformed and oversized bodies fail before any reader callback. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { PassThrough } from "node:stream";
import { QUERY_BUDGET, QUERY_VERSION } from "@ctvs/integration/query";
import { afterEach, expect, it, vi } from "vitest";
import { queryFailure, queryHttp } from "../../src/query/http.js";
import type { Runner } from "../../src/runner.js";
import { queryFixture } from "./query-fixture.js";

afterEach(() => vi.useRealTimers());

it("bounds incomplete and aborted request bodies and releases stream listeners", async () => {
  const make = () => {
    const stream = new PassThrough();
    const request = Object.assign(stream, {
      headers: { "content-type": "application/json" },
      method: "POST",
      url: `/v1/vaults/${"aa".repeat(28)}/read`,
    }) as unknown as IncomingMessage;
    const read = vi.fn();
    const promise = queryHttp(request, {} as ServerResponse, { read } as unknown as Runner);

    return { stream, read, promise };
  };

  vi.useFakeTimers();

  const slow = make();
  const pending = expect(slow.promise).rejects.toMatchObject({ code: "QUERY_LIMIT", status: 408 });

  await vi.advanceTimersByTimeAsync(QUERY_BUDGET.timeoutMs);
  await pending;
  expect(slow.stream.listenerCount("data")).toBe(0);
  expect(slow.read).not.toHaveBeenCalled();

  const aborted = make();

  aborted.stream.emit("aborted");
  await expect(aborted.promise).rejects.toMatchObject({ code: "INVALID_REQUEST" });

  const broken = make();

  broken.stream.emit("error", new Error("socket reset"));
  await expect(broken.promise).rejects.toMatchObject({ code: "INVALID_REQUEST" });

  const huge = make();

  huge.stream.end(Buffer.alloc(QUERY_BUDGET.bodyBytes + 1));
  await expect(huge.promise).rejects.toMatchObject({ code: "QUERY_LIMIT", status: 413 });
});

it("maps query errors without leaking internals or writing a second response", () => {
  const end = vi.fn();
  const response = {
    destroyed: false,
    writableEnded: false,
    statusCode: 200,
    end,
    setHeader: vi.fn(),
  } as unknown as ServerResponse;

  queryFailure(response, new Error("private failure"));
  expect(response.statusCode).toBe(500);
  expect(String(end.mock.calls[0]?.[0])).not.toContain("private failure");
  queryFailure(response, new RangeError("outside"));
  expect(response.statusCode).toBe(400);
  response.destroyed = true;
  queryFailure(response, new Error("closed"));
  expect(end).toHaveBeenCalledTimes(2);
});

it("retains HTTP scope/history and method errors and rejects malformed JSON and option placement", async () => {
  const f = await queryFixture();

  f.sync();

  const route = `${f.url}/v1/vaults/${f.policy}/read`;

  for (const payload of ["not json", Buffer.from([255])]) {
    const response = await fetch(route, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
    });

    expect(response.status).toBe(400);
  }

  expect((await fetch(`${route}?snapshot=true`, { method: "POST" })).status).toBe(400);
  expect((await fetch(`${f.url}/v1/discover`, { method: "POST" })).status).toBe(405);
  expect((await fetch(`${f.url}/v1/discover?share=bad`)).status).toBe(400);
  await expect(f.client.vault("00".repeat(28)).snapshot()).rejects.toMatchObject({
    code: "HISTORY_INCOMPLETE",
  });

  const malformed = await fetch(route, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      apiVersion: QUERY_VERSION,
      queries: { snapshot: true, context: true },
      unknown: true,
    }),
  });

  expect(await malformed.json()).not.toHaveProperty("data");
});

it("rejects an oversized valid response before returning any data", async () => {
  const f = await queryFixture();

  f.sync();

  const original = await f.client.vault(f.policy).read({ context: true });
  const context = original.data.context;

  context.stateInput.value = Object.fromEntries(
    Array.from({ length: 17000 }, (_, i) => [`${i.toString(16).padStart(56, "0")}.`, 1n]),
  );

  const read = vi.spyOn(f.runner, "read").mockImplementation(() => original as never);

  try {
    const response = await f.post({ context: true });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      apiVersion: QUERY_VERSION,
      error: { code: "QUERY_LIMIT", message: "response exceeds budget" },
    });
  } finally {
    read.mockRestore();
  }
});
