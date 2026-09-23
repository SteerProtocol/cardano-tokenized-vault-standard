/**
 * Compile support scripts first, then bind their hashes into each vault template.
 * Source bindings describe the exact authored inputs used to produce local artifacts.
 */

import { execFileSync } from "node:child_process";
import { closeSync, copyFileSync, mkdirSync, openSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type BlueprintValidator,
  compiler,
  compilerVersion,
  findValidator,
  type Implementation,
  readBlueprint,
  referenceRoot,
  sha256,
} from "./project.js";
import { bindTemplates, cacheDependencies, stageProject } from "./staging.js";

/**
 * Record both the ledger script identity and a digest of the serialized artifact.
 * The template hash is not a deployed vault policy until its seed and Terms
 * parameters have been applied; compiledBytes is not a publication transaction size.
 */
export function scriptSummary(validator: BlueprintValidator) {
  return {
    templateHash: validator.hash,
    compiledBytes: validator.compiledCode.length / 2,
    sha256: sha256(Buffer.from(validator.compiledCode, "hex")),
  };
}

/**
 * Rebuild one family with the pinned compiler, then write its blueprint and manifest.
 * The exclusive family lock covers staging, both compilation passes and the optional
 * verification callback. The callback receives the staged project and may throw;
 * artifacts are already written at that point, while lock release is guaranteed.
 * The returned directory is disposable and will be replaced by the next family build.
 */
export function buildImplementation(
  implementation: Implementation,
  verify?: (directory: string) => void,
): string {
  const version = execFileSync(compiler, ["--version"], { encoding: "utf8" }).trim();

  if (version !== compilerVersion) throw new Error(`Expected ${compilerVersion}; found ${version}`);

  const artifacts = join(referenceRoot, "artifacts", implementation);

  mkdirSync(artifacts, { recursive: true });

  const lockPath = join(artifacts, ".build.lock");
  // A family has one staging directory; concurrent builds could mix source bindings and scripts.
  const lock = openSync(lockPath, "wx");

  try {
    const { directory, sources } = stageProject(implementation);

    const run = () =>
      execFileSync(
        compiler,
        ["build", "--trace-level", "silent", "--include-all-types", "--deny"],
        { cwd: directory, stdio: "inherit" },
      );

    // Support scripts must be independent of these placeholders. The second pass binds
    // their real hashes into the vault; checking them again detects a dependency cycle.
    bindTemplates(directory, "00".repeat(28), "00".repeat(28));
    run();

    let blueprint = readBlueprint(join(directory, "plutus.json"));
    const config = findValidator(blueprint, "config_lock.config_lock.spend");
    const claim =
      implementation === "ctvs2" ? findValidator(blueprint, "claim.claim_guard.spend") : null;

    bindTemplates(directory, config.hash, claim?.hash ?? "00".repeat(28));
    run();
    blueprint = readBlueprint(join(directory, "plutus.json"));

    if (
      findValidator(blueprint, config.title).hash !== config.hash ||
      (claim && findValidator(blueprint, claim.title).hash !== claim.hash)
    )
      throw new Error("Support-script dependency cycle detected");

    const spend = findValidator(blueprint, "vault.vault.spend");
    const mint = findValidator(blueprint, "vault.vault.mint");

    // State custody and share issuance must refer to one parameterized program.
    // Comparing bytes as well as hashes also catches inconsistent compiler output.
    if (mint.hash !== spend.hash || mint.compiledCode !== spend.compiledCode)
      throw new Error("Vault mint/spend identities differ");

    const manifest = {
      implementation,
      compiler: version,
      stdlib: "v3.1.0",
      fuzz: "v2.2.0",
      plutus: "v3",
      wire: 2,
      profile: 0,
      permittedExecutionModes: implementation === "ctvs1" ? [1, 2, 3] : [4, 8, 12],
      configLock: scriptSummary(config),
      claim: claim ? scriptSummary(claim) : null,
      vault: scriptSummary(spend),
      vaultParameters: ["seed: OutputReference", "commitment: ByteArray"],
      sources,
      publication: "requires-complete-transaction-evaluation",
      networkDeployment: false,
    };

    copyFileSync(join(directory, "plutus.json"), join(artifacts, "blueprint.json"));
    writeFileSync(join(artifacts, "build.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    cacheDependencies(directory);
    console.log(`${implementation}: vault template ${manifest.vault.compiledBytes} bytes`);
    verify?.(directory);

    return directory;
  } finally {
    closeSync(lock);
    unlinkSync(lockPath);
  }
}
