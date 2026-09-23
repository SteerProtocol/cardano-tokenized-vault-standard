/**
 * Shared paths, compiler pin and blueprint readers for the local build tools.
 * Blueprint shape checks establish readable artifacts, not reviewed script provenance.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const referenceRoot = fileURLToPath(new URL("../../", import.meta.url));
export const compiler = process.env.AIKEN ?? "aiken";
export const compilerVersion = "aiken v1.1.22+39d6b04";
export const implementations = ["ctvs1", "ctvs2"] as const;
export type Implementation = (typeof implementations)[number];

/**
 * No selector means both independent families; a single exact name narrows the run.
 * Reject extra arguments so a mistyped selector cannot silently build the other family.
 */
export function selectedImplementations(args: string[]): Implementation[] {
  if (args.length === 0) return [...implementations];

  if (args.length === 1 && (args[0] === "ctvs1" || args[0] === "ctvs2")) return [args[0]];

  throw new Error("Expected no argument, ctvs1, or ctvs2");
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface BlueprintValidator {
  title: string;
  hash: string;
  compiledCode: string;
  parameters?: unknown[];
}
export interface Blueprint {
  validators: BlueprintValidator[];
}

/**
 * Parse the subset of compiler output needed by staging and parameter application.
 * Only consumed fields are checked, so unrelated blueprint metadata is retained but
 * not trusted as validation evidence. Missing files, malformed JSON and malformed
 * validator entries fail the build rather than producing an empty validator list.
 */
export function readBlueprint(path: string): Blueprint {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));

  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("validators" in parsed) ||
    !Array.isArray(parsed.validators)
  ) {
    throw new Error(`Invalid blueprint: ${path}`);
  }

  for (const validator of parsed.validators as unknown[]) {
    if (
      !validator ||
      typeof validator !== "object" ||
      !("title" in validator) ||
      typeof validator.title !== "string" ||
      !("hash" in validator) ||
      typeof validator.hash !== "string" ||
      !("compiledCode" in validator) ||
      typeof validator.compiledCode !== "string"
    ) {
      throw new Error(`Malformed validator in ${path}`);
    }
  }

  return parsed as Blueprint;
}

/**
 * Resolve an exact compiler-qualified validator title, including its purpose suffix.
 * Choosing a similarly named handler as a fallback could bind the wrong support script.
 */
export function findValidator(blueprint: Blueprint, title: string): BlueprintValidator {
  const found = blueprint.validators.find((item) => item.title === title);

  if (!found) throw new Error(`Missing compiled validator ${title}`);

  return found;
}
