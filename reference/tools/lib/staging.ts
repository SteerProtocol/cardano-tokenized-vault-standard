/**
 * Assemble one family and the shared Aiken package in disposable build storage.
 * Authored files remain canonical; staging preserves their bytes and records hashes.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { type Implementation, referenceRoot, sha256 } from "./project.js";

/** A manifest entry binds a repository source path to the exact copied bytes, including comments. */
export interface SourceBinding {
  path: string;
  sha256: string;
}

/**
 * Copy a source tree without rewriting bytes and append its file digests to bindings.
 * Missing optional trees are ignored, but symlinks, duplicate destinations and an
 * authored deployment module are rejected. A failure can leave a partial destination
 * and binding list; the caller must abandon that staging run rather than reuse it.
 */
export function mergeDirectory(
  source: string,
  destination: string,
  bindings: SourceBinding[],
): void {
  if (!existsSync(source)) return;

  mkdirSync(destination, { recursive: true });

  for (const entry of readdirSync(source, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const from = join(source, entry.name),
      to = join(destination, entry.name);

    if (entry.isSymbolicLink()) throw new Error(`Unexpected source symlink: ${from}`);

    if (entry.isDirectory()) mergeDirectory(from, to, bindings);
    else if (entry.isFile()) {
      if (entry.name === "deployment.ak" && source.endsWith("/lib/ctvs"))
        throw new Error(`Reserved generated module cannot be authored: ${from}`);

      // Equal bytes still mean ambiguous ownership; a family cannot shadow a shared module.
      if (existsSync(to)) throw new Error(`Conflicting authored sources at ${to}`);

      const data = readFileSync(from);

      writeFileSync(to, data);
      bindings.push({ path: relative(referenceRoot, from), sha256: sha256(data) });
    }
  }
}

/**
 * Replace the family's staging tree and merge shared and family modules into it.
 * The family's manifest/lock choose dependencies; cached package files only avoid
 * redundant downloads. Call under the family build lock because replacement is
 * destructive to earlier staging, though it never removes canonical authored source.
 */
export function stageProject(implementation: Implementation): {
  directory: string;
  sources: SourceBinding[];
} {
  const directory = join(referenceRoot, ".build", implementation);

  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });

  const shared = join(referenceRoot, "packages/onchain");
  const family = join(referenceRoot, "implementations", implementation, "onchain");
  const sources: SourceBinding[] = [];

  for (const subdirectory of ["lib", "validators"]) {
    mergeDirectory(join(shared, subdirectory), join(directory, subdirectory), sources);
    mergeDirectory(join(family, subdirectory), join(directory, subdirectory), sources);
  }

  for (const file of ["aiken.toml", "aiken.lock"]) {
    const from = join(family, file);
    const data = readFileSync(from);

    writeFileSync(join(directory, file), data);
    sources.push({ path: relative(referenceRoot, from), sha256: sha256(data) });
  }

  const cache = join(referenceRoot, ".build/dependency-cache/packages");

  if (existsSync(cache)) cpSync(cache, join(directory, "build/packages"), { recursive: true });

  return { directory, sources };
}

/**
 * Retain downloaded packages after a build for subsequent isolated projects.
 * This copies dependency material only, not compiled scripts or generated source;
 * the next staged manifest and lock remain responsible for dependency selection.
 */
export function cacheDependencies(directory: string): void {
  const packages = join(directory, "build/packages");

  if (existsSync(packages))
    cpSync(packages, join(referenceRoot, ".build/dependency-cache/packages"), { recursive: true });
}

/**
 * Write the reserved support-script binding module into the supplied staging tree.
 * Hashes must be full 28-byte lowercase identities. The first compilation deliberately
 * supplies zero placeholders; the second uses discovered identities and verifies
 * that the support scripts do not themselves depend on these bindings.
 */
export function bindTemplates(directory: string, configLock: string, claim: string): void {
  if (!/^[a-f0-9]{56}$/.test(configLock) || !/^[a-f0-9]{56}$/.test(claim))
    throw new Error("Invalid support-script hash");

  const path = join(directory, "lib/ctvs/deployment.ak");

  mkdirSync(join(directory, "lib/ctvs"), { recursive: true });
  writeFileSync(
    path,
    `/// Generated in disposable build staging only.\npub const config_lock_hash: ByteArray =\n  #"${configLock}"\n\n` +
      `pub const claim_hash: ByteArray =\n  #"${claim}"\n`,
  );
}
