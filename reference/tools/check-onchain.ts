/**
 * Compile isolated family projects and retain deterministic Aiken test evidence.
 * A successful process must also report a nonempty, entirely passing test suite.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildImplementation } from "./lib/build.js";
import {
  compiler,
  type Implementation,
  referenceRoot,
  selectedImplementations,
} from "./lib/project.js";

/**
 * Require structured proof that at least one test ran and every reported test passed.
 * A zero process exit alone could hide an empty suite or an unexpected output format;
 * malformed JSON and incomplete summaries therefore fail this validation stage.
 */
function readAikenSummary(stdout: string) {
  const report: unknown = JSON.parse(stdout);

  if (!report || typeof report !== "object" || !("summary" in report))
    throw new Error("Missing Aiken summary");

  const summary = report.summary;

  if (
    !summary ||
    typeof summary !== "object" ||
    !("failed" in summary) ||
    summary.failed !== 0 ||
    !("total" in summary) ||
    typeof summary.total !== "number" ||
    summary.total <= 0 ||
    !("passed" in summary) ||
    summary.passed !== summary.total
  )
    throw new Error("Missing Aiken summary");

  return summary;
}

/**
 * Run the compiled family's tests in its staged directory with reproducible fuzzing.
 * The seed and success count are shared across runs; captured stdout/stderr remain
 * available on failure. This checks Aiken contexts, not complete node acceptance.
 */
function checkImplementation(implementation: Implementation, directory: string): void {
  const output = join(referenceRoot, "artifacts", implementation);

  mkdirSync(output, { recursive: true });

  const result = spawnSync(
    compiler,
    ["check", "--deny", "--seed", "20260916", "--max-success", "1000"],
    {
      cwd: directory,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );

  // Preserve diagnostics before throwing so unsuccessful runs remain inspectable too.
  writeFileSync(join(output, "aiken-tests.json"), result.stdout ?? "");
  writeFileSync(join(output, "aiken-tests.stderr"), result.stderr ?? "");

  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? "");
    process.stdout.write(result.stdout ?? "");

    throw result.error ?? new Error(`${implementation} Aiken tests failed`);
  }

  console.log(implementation, readAikenSummary(result.stdout));
}

for (const implementation of selectedImplementations(process.argv.slice(2))) {
  buildImplementation(implementation, (directory) => {
    checkImplementation(implementation, directory);
  });
}
