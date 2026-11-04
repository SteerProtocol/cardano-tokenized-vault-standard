/** Whole-process peak RSS, including compilation, measured in isolated sequential runs. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { discoveryCalls } from "../test/fixtures/calls.js";
import { nativeRequest } from "../test/fixtures/discovery.js";
import { startHttpFixture } from "../test/fixtures/http.js";

const run = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "ctvs-plugin-memory-"));
const repetitions = 3;
let closeHttp;

async function runtimeBytes(directory) {
  const files = await readdir(directory);
  const sizes = await Promise.all(
    files
      .filter((name) => /\.(js|wasm)$/.test(name))
      .map(async (name) => (await stat(join(directory, name))).size),
  );

  return sizes.reduce((sum, size) => sum + size, 0);
}

async function measure(host, language, input) {
  const memoryFile = join(temporary, "memory.txt");
  const executable =
    host === "jco" ? process.execPath : join(root, "host/rust/target/release/example-plugin-host");
  const args = host === "jco" ? [join(root, "tools/measure-node.js")] : [];
  const timeArgs = process.platform === "darwin" ? ["-l"] : ["-v"];
  const child = run("/usr/bin/time", [...timeArgs, "-o", memoryFile, executable, ...args], {
    env: { ...process.env, EXAMPLE_PLUGIN_GUEST: language },
    timeout: 120000,
    maxBuffer: 16 * 1024 * 1024,
  });

  child.child.stdin.end(JSON.stringify(input));

  const { stdout } = await child;
  const memory = await readFile(memoryFile, "utf8");
  const match =
    process.platform === "darwin"
      ? /([0-9]+)\s+maximum resident set size/.exec(memory)
      : /Maximum resident set size \(kbytes\): ([0-9]+)/.exec(memory);

  if (!match) throw new Error(`unrecognized time output: ${memory}`);

  return {
    peakRssBytes: Number(match[1]) * (process.platform === "darwin" ? 1 : 1024),
    result: JSON.parse(stdout),
  };
}

try {
  assert.ok(["darwin", "linux"].includes(process.platform), "measurement supports macOS/Linux");

  const { origin } = await startHttpFixture({
    after: (close) => {
      closeHttp = close;
    },
  });
  const discoveries = discoveryCalls();
  const urls = ["/delayed", "/missing", "/redirect", "/disconnect"].map(
    (path) => `${origin}${path}`,
  );
  const measurements = [];
  let expected;

  for (const language of ["rust", "typescript"]) {
    const component = join(
      root,
      language === "rust" ? "dist/plugin.wasm" : "dist/typescript/plugin.wasm",
    );
    const bindings = join(root, language === "rust" ? "dist/js" : "dist/typescript/js");

    for (const host of ["jco", "wasmtime"]) {
      const peaks = [];

      for (let repetition = 0; repetition < repetitions; repetition++) {
        const input =
          host === "jco"
            ? { discoveries, urls }
            : { component, discoveries: discoveries.map(nativeRequest), urls };
        const { peakRssBytes, result } = await measure(host, language, input);
        const output = { discoveries: result.discoveries, fetches: result.fetches };

        expected ??= output;
        assert.deepEqual(output, expected, `${host}/${language} output differs`);
        peaks.push(peakRssBytes);
      }

      measurements.push({
        language,
        host,
        componentBytes: (await stat(component)).size,
        jcoRuntimeBytes: await runtimeBytes(bindings),
        peakRssBytes: peaks,
        medianPeakRssBytes: [...peaks].sort((a, b) => a - b)[1],
      });
    }
  }

  const report = {
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    repetitions,
    workload: "11 discovery calls (including 10,001-rule inputs), 4 HTTP calls",
    metric:
      "fresh-process peak RSS including host startup, compilation, guest and workload; not guest-only memory",
    measurements,
  };

  await writeFile(join(root, "dist/comparison.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await closeHttp?.();
  await rm(temporary, { recursive: true, force: true });
}
