/** Client transport boundaries and the browser runtime graph are part of the public contract. */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { afterEach, expect, it, vi } from "vitest";
import { createIndexerClient } from "../src/client/index.js";
import { dispatchRead } from "../src/dispatch.js";
import { encodeQueryResponse, QUERY_BUDGET, QUERY_VERSION } from "../src/query/index.js";
import { readerFixture } from "./fixtures.js";

afterEach(() => vi.useRealTimers());

const f = readerFixture();
const view = dispatchRead(
  f.reader,
  f.policy,
  { apiVersion: QUERY_VERSION, queries: { snapshot: true } },
  { instance: "test", recoveryGeneration: 1 },
);

const json = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "application/json; charset=utf-8" } });

const client = (fetcher: typeof fetch, timeoutMs?: number) =>
  createIndexerClient({
    baseUrl: "https://indexer.test/api/",
    expectedNetwork: f.network,
    fetch: fetcher,
    ...(timeoutMs ? { timeoutMs } : {}),
  });

it("keeps base paths, detaches decoded responses and checks the complete expected basis", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => json(encodeQueryResponse(view)));
  const vault = client(fetcher).vault(f.policy);
  const first = await vault.snapshot();

  first.data.state.backingAssets = 0n;
  expect((await vault.snapshot()).data.state.backingAssets).toBe(
    view.data.snapshot.state.backingAssets,
  );
  expect(String(fetcher.mock.calls[0]?.[0])).toBe(
    `https://indexer.test/api/v1/vaults/${f.policy}/read`,
  );
  await expect(
    vault.snapshot({ expectedBasis: { ...view.basis, recoveryGeneration: 2 } }),
  ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  await expect(vault.snapshot({ expectedBasis: view.basis })).resolves.toMatchObject({
    basis: view.basis,
  });
});

it("preserves typed errors and rejects invalid JSON, bodies, versions and error shapes without retrying", async () => {
  const error = { apiVersion: QUERY_VERSION, error: { code: "STALE_BASIS", message: "changed" } };
  const cases = [
    new Response("{}"),
    new Response(null, { headers: { "content-type": "application/json" } }),
    json("not json"),
    new Response(new Uint8Array([255]), { headers: { "content-type": "application/json" } }),
    json(JSON.stringify({ ...error, apiVersion: "wrong" }), 409),
    json(JSON.stringify({ ...error, error: { code: "OTHER", message: "bad" } }), 500),
    json(JSON.stringify({ ...JSON.parse(encodeQueryResponse(view)), apiVersion: "wrong" })),
  ];

  for (const response of cases) {
    const fetcher = vi.fn<typeof fetch>(async () => response);

    await expect(client(fetcher).vault(f.policy).snapshot()).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    expect(fetcher).toHaveBeenCalledOnce();
  }

  const fetcher = vi.fn<typeof fetch>(async () => json(JSON.stringify(error), 409));

  await expect(client(fetcher).vault(f.policy).snapshot()).rejects.toMatchObject({
    code: "STALE_BASIS",
    message: "changed",
    status: 409,
  });
  expect(fetcher).toHaveBeenCalledOnce();
});

it("cancels an oversized chunked response even without a content length", async () => {
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(QUERY_BUDGET.responseBytes + 1));
    },
    cancel,
  });
  const fetcher = vi.fn<typeof fetch>(
    async () => new Response(stream, { headers: { "content-type": "application/json" } }),
  );

  await expect(client(fetcher).vault(f.policy).snapshot()).rejects.toMatchObject({
    code: "QUERY_LIMIT",
  });
  expect(cancel).toHaveBeenCalledOnce();
});

it("propagates cancellation and timeout during fetch or streaming without retries", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  const fetcher = vi.fn<typeof fetch>(
    (_url, options) =>
      new Promise((_resolve, reject) => {
        const signal = options?.signal;

        if (signal?.aborted) reject(signal.reason);
        else signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
  );
  const controller = new AbortController();
  const cancelled = client(fetcher).vault(f.policy).snapshot({ signal: controller.signal });
  const checked = expect(cancelled).rejects.toMatchObject({ name: "AbortError" });

  controller.abort();
  await checked;
  // AbortSignal.timeout uses the platform timer, independent of mocked global timers.
  vi.useRealTimers();
  await expect(client(fetcher, 5).vault(f.policy).snapshot()).rejects.toMatchObject({
    name: "TimeoutError",
  });

  const streamed = vi.fn<typeof fetch>(
    async (_url, options) =>
      new Response(
        new ReadableStream({
          start(sink) {
            options?.signal?.addEventListener("abort", () => sink.error(options.signal?.reason), {
              once: true,
            });
          },
        }),
        { headers: { "content-type": "application/json" } },
      ),
  );

  await expect(client(streamed, 5).vault(f.policy).snapshot()).rejects.toMatchObject({
    name: "TimeoutError",
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(streamed).toHaveBeenCalledOnce();
});

it("rejects invalid client configuration and discovery identities before fetching", async () => {
  const fetcher = vi.fn<typeof fetch>();

  for (const baseUrl of [
    "file:///tmp/indexer",
    "https://a:b@indexer.test/",
    "https://indexer.test/?a=1",
    "https://indexer.test/#fragment",
  ])
    expect(() =>
      createIndexerClient({ baseUrl, expectedNetwork: f.network, fetch: fetcher }),
    ).toThrow("baseUrl");

  for (const timeoutMs of [0, -1, 1.5, Infinity])
    expect(() =>
      createIndexerClient({
        baseUrl: "https://indexer.test",
        expectedNetwork: f.network,
        timeoutMs,
      }),
    ).toThrow("timeout");

  expect(() => client(fetcher).vault("aa")).toThrow();
  await expect(client(fetcher).discover(`${f.policy}.00`)).rejects.toThrow("SHARE");
  expect(fetcher).not.toHaveBeenCalled();
});

it("keeps the client runtime graph inside the client and query modules", () => {
  const root = fileURLToPath(new URL("../src/", import.meta.url));
  const visited = new Set<string>();

  const visit = (path: string) => {
    if (visited.has(path)) return;

    visited.add(path);
    expect(
      path.startsWith(`${resolve(root, "client")}/`) ||
        path.startsWith(`${resolve(root, "query")}/`),
    ).toBe(true);

    const source = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );

    for (const statement of source.statements) {
      const specifier = runtimeImport(statement);

      if (!specifier) continue;

      expect(specifier.startsWith(".")).toBe(true);
      visit(resolve(dirname(path), specifier.replace(/\.js$/, ".ts")));
    }
  };

  visit(resolve(root, "client/index.ts"));
  expect(visited.size).toBeGreaterThan(5);
});

function runtimeImport(node: ts.Statement): string | null {
  if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) return null;

  if (!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) return null;

  if (ts.isImportDeclaration(node) && typeOnlyImport(node.importClause)) return null;

  if (ts.isExportDeclaration(node)) {
    if (node.isTypeOnly) return null;

    if (
      node.exportClause &&
      ts.isNamedExports(node.exportClause) &&
      node.exportClause.elements.every((e) => e.isTypeOnly)
    )
      return null;
  }

  return node.moduleSpecifier.text;
}

function typeOnlyImport(clause: ts.ImportClause | undefined): boolean {
  if (!clause) return false;

  if (clause.isTypeOnly) return true;

  return (
    !clause.name &&
    !!clause.namedBindings &&
    ts.isNamedImports(clause.namedBindings) &&
    clause.namedBindings.elements.every((e) => e.isTypeOnly)
  );
}
