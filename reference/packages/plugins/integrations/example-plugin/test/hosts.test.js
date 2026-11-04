import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { discoveryCalls } from "./fixtures/calls.js";
import { nativeFailure, nativeRequest, nativeSuccess } from "./fixtures/discovery.js";
import { component as componentUrl } from "./fixtures/guest.js";
import { startHttpFixture } from "./fixtures/http.js";
import { discover, fetch as fetchThroughPlugin } from "./fixtures/plugin.js";

const component = fileURLToPath(componentUrl);

function runWasmtime(input) {
  const executable = fileURLToPath(
    new URL("../host/rust/target/release/example-plugin-host", import.meta.url),
  );

  return new Promise((resolve, reject) => {
    const child = execFile(executable, [], { timeout: 60000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`Wasmtime runner failed: ${stderr}`, { cause: error }));

        return;
      }

      try {
        resolve(JSON.parse(stdout));
      } catch (parseError) {
        reject(parseError);
      }
    });

    child.stdin.end(JSON.stringify({ component, ...input }));
  });
}

test("structured discovery pages and errors agree across JCO and Wasmtime", async () => {
  const calls = discoveryCalls();
  const bytes = await readFile(component);
  const result = await runWasmtime({ discoveries: calls.map(nativeRequest), urls: [] });

  assert.equal(result.componentSha256, createHash("sha256").update(bytes).digest("hex"));
  assert.deepEqual(
    result.discoveries,
    calls.map((call) => {
      try {
        return nativeSuccess(discover(call.config, call.cursor, call.pageSize));
      } catch (error) {
        return nativeFailure(error.payload);
      }
    }),
  );
});

test("async GET results and transport errors agree across both hosts", {
  timeout: 60000,
}, async (t) => {
  const { origin, requests } = await startHttpFixture(t);
  const urls = ["/delayed", "/missing", "/redirect", "/disconnect"].map(
    (path) => `${origin}${path}`,
  );
  const expected = [
    { ok: { status: 200, body: "delayed response: \u03bb \uD83C\uDF10" } },
    { ok: { status: 404, body: "not found" } },
    { ok: { status: 302, body: "redirect" } },
    { error: "fetch-failed" },
  ];
  const jsResults = [];
  let heartbeatTicks = 0;
  const heartbeat = setInterval(() => {
    heartbeatTicks += 1;
  }, 2);

  try {
    for (const url of urls) {
      const pending = fetchThroughPlugin(url);

      assert.ok(pending instanceof Promise, "the guest export must suspend through JSPI");

      try {
        jsResults.push({ ok: await pending });
      } catch (error) {
        jsResults.push({ error: error.payload });
      }
    }
  } finally {
    clearInterval(heartbeat);
  }

  assert.deepEqual(jsResults, expected);
  assert.ok(heartbeatTicks > 0, "Node's event loop must progress while the guest waits");

  const rustResult = await runWasmtime({ discoveries: [], urls });

  assert.deepEqual(rustResult.fetches, expected);
  assert.ok(rustResult.heartbeatTicks > 0, "Tokio must progress while the guest waits");
  assert.equal(requests.filter((path) => path === "/delayed").length, 2);
  assert.equal(requests.filter((path) => path === "/missing").length, 2);
  assert.equal(requests.filter((path) => path === "/redirect").length, 2);
  assert.ok(requests.filter((path) => path === "/disconnect").length >= 2);
});
