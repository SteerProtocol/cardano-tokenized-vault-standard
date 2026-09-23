/** Cross-checks script parameter application through Aiken and Lucid, separate from ledger acceptance. */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyDoubleCborEncoding,
  applyParamsToScript,
  Constr,
  validatorToScriptHash,
} from "@lucid-evolution/lucid";
import { expect, test } from "vitest";
import {
  compiler,
  findValidator,
  implementations,
  readBlueprint,
  referenceRoot,
} from "../../../tools/lib/project.js";

test.each(implementations)(
  "%s CLI and Lucid agree on synthetic parameter application, without a ledger transaction",
  (implementation) => {
    // Deliberately synthetic values. They do not identify an available seed
    // UTxO or establish Terms/deployment authentication on any ledger.
    const seed = { txId: "a5".repeat(32), index: 257n };
    const termsCommitment = "b6".repeat(32);
    const directory = join(referenceRoot, "artifacts", implementation);
    const template = findValidator(
      readBlueprint(join(directory, "blueprint.json")),
      "vault.vault.spend",
    );

    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        join(referenceRoot, "tools/apply.ts"),
        "--implementation",
        implementation,
        "--seed",
        seed.txId,
        "--output-index",
        seed.index.toString(),
        "--terms-hash",
        termsCommitment,
      ],
      { cwd: referenceRoot, env: { ...process.env, AIKEN: compiler }, stdio: "pipe" },
    );

    // Construct OutRef independently with Lucid's Data representation instead
    // of routing through the protocol codec used by tools/apply.ts.
    const lucidScript = applyParamsToScript(template.compiledCode, [
      new Constr(0, [seed.txId, seed.index]),
      termsCommitment,
    ]);
    const lucidPolicy = validatorToScriptHash({ type: "PlutusV3", script: lucidScript });
    const applied = readBlueprint(join(directory, "applied.json"));
    const spend = findValidator(applied, "vault.vault.spend");
    const mint = findValidator(applied, "vault.vault.mint");

    expect(spend.hash).toBe(lucidPolicy);
    expect(mint.hash).toBe(lucidPolicy);
    expect(applyDoubleCborEncoding(spend.compiledCode)).toBe(applyDoubleCborEncoding(lucidScript));
    expect(mint.compiledCode).toBe(spend.compiledCode);
    expect(spend.parameters ?? []).toEqual([]);
    expect(mint.parameters ?? []).toEqual([]);

    const manifest: unknown = JSON.parse(
      readFileSync(join(directory, "applied-manifest.json"), "utf8"),
    );

    expect(manifest).toMatchObject({
      implementation,
      seed: { txId: seed.txId, index: seed.index.toString() },
      termsHash: termsCommitment,
      policy: lucidPolicy,
      networkDeployment: false,
    });
    writeFileSync(
      join(directory, "parameter-crosscheck.json"),
      `${JSON.stringify(
        {
          scope: "parameter-application-only",
          implementation,
          syntheticParameters: true,
          networkSubmission: false,
          ledgerAcceptance: false,
          templateHash: template.hash,
          seed: { txId: seed.txId, index: seed.index.toString() },
          termsCommitment,
          policy: lucidPolicy,
          normalizedScriptBytesMatch: true,
        },
        null,
        2,
      )}\n`,
    );
  },
);
