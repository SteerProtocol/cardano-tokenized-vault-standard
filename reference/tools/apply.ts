/**
 * Bind seed and Terms commitment parameters to an already compiled family template.
 * This writes local script artifacts only; it neither creates nor submits a vault.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { bytes, encodeData, hex, outRefData } from "@ctvs/protocol";
import {
  compiler,
  compilerVersion,
  findValidator,
  readBlueprint,
  referenceRoot,
} from "./lib/project.js";

const { values } = parseArgs({
  options: {
    implementation: { type: "string" },
    seed: { type: "string" },
    "output-index": { type: "string", default: "0" },
    "terms-hash": { type: "string" },
  },
  strict: true,
  allowPositionals: false,
});

if (
  (values.implementation !== "ctvs1" && values.implementation !== "ctvs2") ||
  !values.seed ||
  !/^[a-f0-9]{64}$/.test(values.seed) ||
  !values["terms-hash"] ||
  !/^[a-f0-9]{64}$/.test(values["terms-hash"]) ||
  !/^(0|[1-9][0-9]*)$/.test(values["output-index"]) ||
  BigInt(values["output-index"]) > 65535n
) {
  throw new Error(
    "Usage: npm run apply -- --implementation ctvs1|ctvs2 --seed HEX --output-index 0 --terms-hash HEX",
  );
}

const version = execFileSync(compiler, ["--version"], { encoding: "utf8" }).trim();

if (version !== compilerVersion) throw new Error(`Expected ${compilerVersion}; found ${version}`);

const artifactDirectory = join(referenceRoot, "artifacts", values.implementation);
const seed = { txId: values.seed, index: BigInt(values["output-index"]) };

const apply = (from: string, to: string, parameter: string): void => {
  execFileSync(
    compiler,
    [
      "blueprint",
      "apply",
      "--in",
      join(artifactDirectory, from),
      "--out",
      join(artifactDirectory, to),
      "--module",
      "vault",
      "--validator",
      "vault",
      parameter,
    ],
    { stdio: "inherit" },
  );
};

// Parameter order is part of the compiled template: seed first, Terms commitment second.
apply("blueprint.json", "seed-applied.json", hex(encodeData(outRefData(seed))));
apply("seed-applied.json", "applied.json", hex(encodeData(bytes(values["terms-hash"]))));

const blueprint = readBlueprint(join(artifactDirectory, "applied.json"));
const spend = findValidator(blueprint, "vault.vault.spend"),
  mint = findValidator(blueprint, "vault.vault.mint");

if (
  spend.hash !== mint.hash ||
  spend.compiledCode !== mint.compiledCode ||
  spend.parameters?.length
)
  throw new Error("Invalid parameter binding");

const result = {
  implementation: values.implementation,
  seed: { ...seed, index: seed.index.toString() },
  termsHash: values["terms-hash"],
  policy: spend.hash,
  compiledBytes: spend.compiledCode.length / 2,
  networkDeployment: false,
};

writeFileSync(
  join(artifactDirectory, "applied-manifest.json"),
  `${JSON.stringify(result, null, 2)}\n`,
);
console.log(JSON.stringify(result, null, 2));
