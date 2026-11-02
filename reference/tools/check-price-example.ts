/**
 * Build and test the isolated Price example with canonical shared modules.
 * Example validators never enter either production reference family's blueprint.
 * Artifacts establish compiled handler checks, not signed or node-backed execution.
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { compiler, compilerVersion, referenceRoot, sha256 } from "./lib/project.js";
import { mergeDirectory, type SourceBinding } from "./lib/staging.js";

const directory = join(referenceRoot, ".build/price-provider");
const artifacts = join(referenceRoot, "artifacts/price-provider");
const example = join(referenceRoot, "examples/price-provider/onchain");

/** Copy exact authored bytes, including the small, explicit shared dependency set. */
function stage(): SourceBinding[] {
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(join(directory, "lib/ctvs"), { recursive: true });

  const sources: SourceBinding[] = [];

  for (const name of ["price", "wire", "validation", "ledger"]) {
    const source = join(referenceRoot, `packages/onchain/lib/ctvs/${name}.ak`);
    const bytes = readFileSync(source);

    writeFileSync(join(directory, `lib/ctvs/${name}.ak`), bytes);
    sources.push({ path: relative(referenceRoot, source), sha256: sha256(bytes) });
  }

  for (const subtree of ["lib", "validators"])
    mergeDirectory(join(example, subtree), join(directory, subtree), sources);

  for (const name of ["aiken.toml", "aiken.lock"]) {
    const source = join(example, name);
    const bytes = readFileSync(source);

    writeFileSync(join(directory, name), bytes);
    sources.push({ path: relative(referenceRoot, source), sha256: sha256(bytes) });
  }

  const cache = join(referenceRoot, ".build/dependency-cache/packages");

  if (existsSync(cache)) cpSync(cache, join(directory, "build/packages"), { recursive: true });

  return sources;
}

/** Reject empty or failing summaries; exit status alone is insufficient test evidence. */
function checkSummary(stdout: string): unknown {
  const report: unknown = JSON.parse(stdout);

  if (!report || typeof report !== "object" || !("summary" in report))
    throw new Error("Missing example test summary");

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
    throw new Error("Empty or failing example test suite");

  return summary;
}

const version = execFileSync(compiler, ["--version"], { encoding: "utf8" }).trim();

if (version !== compilerVersion) throw new Error(`Unexpected compiler: ${version}`);

mkdirSync(artifacts, { recursive: true });

const lockPath = join(artifacts, ".build.lock");
const lock = openSync(lockPath, "wx");

try {
  const sources = stage();

  execFileSync(compiler, ["build", "--trace-level", "silent", "--include-all-types", "--deny"], {
    cwd: directory,
    stdio: "inherit",
  });

  const result = spawnSync(compiler, ["check", "--deny"], {
    cwd: directory,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

  writeFileSync(join(artifacts, "aiken-tests.json"), result.stdout ?? "");
  writeFileSync(join(artifacts, "aiken-tests.stderr"), result.stderr ?? "");

  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? "");
    process.stdout.write(result.stdout ?? "");

    throw result.error ?? new Error("Price example tests failed");
  }

  const summary = checkSummary(result.stdout);

  cpSync(join(directory, "plutus.json"), join(artifacts, "blueprint.json"));
  writeFileSync(
    join(artifacts, "build.json"),
    `${JSON.stringify(
      {
        compiler: version,
        sources,
        summary,
        validation: "synthetic-handler-contexts",
        networkDeployment: false,
      },
      null,
      2,
    )}\n`,
  );
  // Read the family cache only. This example's smaller dependency manifest must
  // never overwrite the cached package-resolution metadata used by the families.
  console.log("price-provider", summary);
} finally {
  closeSync(lock);
  unlinkSync(lockPath);
}
