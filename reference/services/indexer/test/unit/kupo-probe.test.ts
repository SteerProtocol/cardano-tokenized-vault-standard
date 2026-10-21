/** Fail closed on malformed transport, incomplete history declarations and header/database disagreement. */
import { rmSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { KupoReconciliation } from "../../src/chain/kupo-reconciliation.js";
import { active, kupoFixture, transport } from "./kupo-fixture.js";

const directories: string[] = [];

afterEach(() => {
  vi.unstubAllGlobals();

  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

function fixture() {
  const f = kupoFixture();

  directories.push(f.directory);

  return f;
}

it.each([
  ["version", "v2.13.0", "unsupported_version"],
  ["version", "v2.12.0", "unsupported_version"],
  ["version", "v2.12.0+abcdef", "unsupported_version"],
  ["connection_status", "disconnected", "kupo_disconnected"],
  ["most_recent_checkpoint", 0, "health_point_mismatch"],
  ["most_recent_checkpoint", 2, "health_point_mismatch"],
  ["most_recent_node_tip", 2, "health_point_mismatch"],
  ["most_recent_checkpoint", 9007199254740992, "invalid_response"],
  ["most_recent_checkpoint", null, "invalid_response"],
])("rejects health %s=%s", async (key, value, reason) => {
  const f = fixture();

  transport(f.target.point, async (path, result) => {
    if (path !== "/health") return result;

    return new Response(JSON.stringify({ ...(await result.json()), [key as string]: value }), {
      headers: result.headers,
    });
  });
  await f.reconciliation.check(f.target, active());
  expect(f.reconciliation.status(f.target)).toMatchObject({ verification: "unverified", reason });
});

it.each([
  ["etag", "ab".repeat(32)],
  ["x-most-recent-checkpoint", "2"],
  ["etag", ""],
])("rejects conflicting or missing %s headers", async (key, value) => {
  const f = fixture();

  transport(f.target.point, async (_path, result) => {
    result.headers.set(key, value);

    return result;
  });
  await f.reconciliation.check(f.target, active());
  expect(f.reconciliation.status(f.target).reason).toBe("header_point_mismatch");
});

it.each([0, 2, "fork", "empty", "rollback"])(
  "rejects a database head at %s despite matching health and headers",
  async (mode) => {
    const f = fixture();

    transport(f.target.point, async (path, result, call) => {
      if (path !== "/checkpoints" || (mode === "rollback" && call !== 4)) return result;

      const points =
        mode === "empty"
          ? []
          : [
              {
                slot_no: typeof mode === "number" ? mode : 1,
                header_hash: typeof mode === "number" ? f.block.point.blockHash : "ab".repeat(32),
              },
            ];

      return new Response(JSON.stringify(points), { headers: result.headers });
    });
    await f.reconciliation.check(f.target, active());
    expect(f.reconciliation.status(f.target).reason).toBe(
      mode === "empty" ? "missing_checkpoint" : "database_point_mismatch",
    );
  },
);

it.each([[], ["addr_test"], ["*", "addr_test"], null])(
  "rejects incompatible runtime patterns %s",
  async (patterns) => {
    const f = fixture();

    transport(f.target.point, async (path, result) =>
      path === "/patterns" ? new Response(JSON.stringify(patterns)) : result,
    );
    await f.reconciliation.check(f.target, active());
    expect(f.reconciliation.status(f.target).reason).toBe("coverage_mismatch");
  },
);

it("refuses undeclared coverage even with matching live wildcard patterns", async () => {
  const f = fixture();

  f.config.kupoCoverage = null;

  const reconciliation = new KupoReconciliation(f.config);

  transport(f.target.point);
  await reconciliation.check(f.target, active());
  expect(reconciliation.status(f.target)).toMatchObject({
    reason: "coverage_undeclared",
    verification: "unverified",
  });
});

it.each([202, 304, 503])("does not treat HTTP %s as caught up", async (status) => {
  const f = fixture();

  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status })),
  );
  await f.reconciliation.check(f.target, active());
  expect(f.reconciliation.status(f.target)).toMatchObject({
    reachable: true,
    reason: "http_unavailable",
  });
});

it.each(["oversized_header", "oversized_stream", "invalid_json", "no_body"])(
  "rejects %s without an unbounded read",
  async (mode) => {
    const f = fixture();
    const body =
      mode === "oversized_stream" ? " ".repeat(65537) : mode === "no_body" ? null : "bad";

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(body, {
            headers: mode === "oversized_header" ? { "content-length": "65537" } : {},
          }),
      ),
    );
    await f.reconciliation.check(f.target, active());
    expect(f.reconciliation.status(f.target).reason).toBe(
      mode.startsWith("oversized") ? "response_limit" : "invalid_response",
    );
  },
);

it("loses a previous proof immediately when probing again and cancels outstanding transport", async () => {
  const f = fixture();

  transport(f.target.point);
  await f.reconciliation.check(f.target, active());
  expect(f.reconciliation.status(f.target).verification).toBe("verified");
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (_url: unknown, options?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(new Error("offline")), {
            once: true,
          });
        }),
    ),
  );

  const controller = new AbortController();
  const pending = f.reconciliation.check(f.target, controller.signal);

  expect(f.reconciliation.status(f.target).verification).toBe("unverified");
  controller.abort();
  await pending;
  expect(f.reconciliation.status(f.target)).toMatchObject({
    reason: "probe_aborted",
    reachable: false,
  });
});

it("bounds the whole probe deadline, including transport wait", async () => {
  const f = fixture();

  f.config.limits.requestTimeoutMs = 10;

  const reconciliation = new KupoReconciliation(f.config);

  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (_url: unknown, options?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(new Error("timed out")), {
            once: true,
          });
        }),
    ),
  );
  await reconciliation.check(f.target, active());
  expect(reconciliation.status(f.target).reason).toBe("probe_aborted");
});

it("bounds response-body wait after headers arrive", async () => {
  const f = fixture();

  f.config.limits.requestTimeoutMs = 10;

  const reconciliation = new KupoReconciliation(f.config);

  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (_url: unknown, options?: RequestInit) =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("{"));
              options?.signal?.addEventListener(
                "abort",
                () => controller.error(new Error("body timed out")),
                { once: true },
              );
            },
          }),
        ),
    ),
  );
  await reconciliation.check(f.target, active());
  expect(reconciliation.status(f.target)).toMatchObject({
    reason: "probe_aborted",
    verification: "unverified",
  });
});

it("rejects a changed health point after both database reads succeed", async () => {
  const f = fixture();

  transport(f.target.point, async (_path, result, call) => {
    if (call === 5) result.headers.set("etag", "ab".repeat(32));

    return result;
  });
  await f.reconciliation.check(f.target, active());
  expect(f.reconciliation.status(f.target).reason).toBe("header_point_mismatch");
});
