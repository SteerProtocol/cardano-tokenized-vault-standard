/**
 * Protect reproducible staging: exact source bytes, complete bindings and no shadowed modules.
 * Temporary trees intentionally include collisions, symlinks and non-source byte sequences.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterEach, expect, test } from "vitest";
import { referenceRoot } from "./project.js";
import { bindTemplates, mergeDirectory, type SourceBinding } from "./staging.js";

const temporaryDirectories: string[] = [];

function temporaryTree(): string {
  const directory = mkdtempSync(join(tmpdir(), "ctvs-staging-test-"));

  temporaryDirectories.push(directory);

  return directory;
}

function write(path: string, data: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("merges shared and family modules without rewriting bytes or losing source bindings", () => {
  const tree = temporaryTree();
  const shared = join(tree, "shared/lib"),
    family = join(tree, "family/lib");
  const destination = join(tree, "staged/lib");
  const sharedPath = join(shared, "ctvs/wire.ak"),
    familyPath = join(family, "ctvs1/state.ak");
  const sharedBytes = Buffer.from("pub const version = 2\r\n// source spacing  \r\n");
  const familyBytes = Buffer.from([0, 255, 13, 10, 65]);

  write(sharedPath, sharedBytes);
  write(familyPath, familyBytes);

  const bindings: SourceBinding[] = [];

  mergeDirectory(shared, destination, bindings);
  mergeDirectory(family, destination, bindings);
  expect(readFileSync(join(destination, "ctvs/wire.ak"))).toEqual(sharedBytes);
  expect(readFileSync(join(destination, "ctvs1/state.ak"))).toEqual(familyBytes);
  expect(bindings).toEqual([
    {
      path: relative(referenceRoot, sharedPath),
      sha256: createHash("sha256").update(sharedBytes).digest("hex"),
    },
    {
      path: relative(referenceRoot, familyPath),
      sha256: createHash("sha256").update(familyBytes).digest("hex"),
    },
  ]);
  expect(readFileSync(sharedPath)).toEqual(sharedBytes);
  expect(readFileSync(familyPath)).toEqual(familyBytes);
});

test("rejects a duplicate module even if both authored copies have identical bytes", () => {
  const tree = temporaryTree();
  const shared = join(tree, "shared/lib"),
    family = join(tree, "family/lib"),
    staged = join(tree, "staged/lib");

  write(join(shared, "ctvs/math.ak"), "abc");
  write(join(family, "ctvs/math.ak"), "abc");

  const bindings: SourceBinding[] = [];

  mergeDirectory(shared, staged, bindings);
  expect(() => mergeDirectory(family, staged, bindings)).toThrow(/Conflicting authored sources/);
  expect(readFileSync(join(staged, "ctvs/math.ak"), "utf8")).toBe("abc");
  expect(bindings).toHaveLength(1);
  expect(bindings[0]?.sha256).toBe(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test.each(["packages/onchain", "implementations/ctvs1/onchain", "implementations/ctvs2/onchain"])(
  "reserves canonical ctvs/deployment.ak against authored input from %s",
  (origin) => {
    const tree = temporaryTree();
    const source = join(tree, origin, "lib"),
      staged = join(tree, "staged/lib");

    write(join(source, "ctvs/deployment.ak"), 'pub const config_lock_hash = #"ff"');

    const bindings: SourceBinding[] = [];

    expect(() => mergeDirectory(source, staged, bindings)).toThrow(/Reserved generated module/);
    expect(existsSync(join(staged, "ctvs/deployment.ak"))).toBe(false);
    expect(bindings).toEqual([]);
  },
);

test.each(["file", "directory"] as const)(
  "rejects source %s symlinks instead of following them",
  (kind) => {
    const tree = temporaryTree(),
      source = join(tree, "source/lib"),
      staged = join(tree, "staged/lib");

    mkdirSync(source, { recursive: true });

    const target = join(tree, "elsewhere");

    if (kind === "file") write(target, "must not copy");
    else write(join(target, "nested.ak"), "must not copy");

    symlinkSync(target, join(source, "linked"), kind === "file" ? "file" : "dir");

    const bindings: SourceBinding[] = [];

    expect(() => mergeDirectory(source, staged, bindings)).toThrow(/Unexpected source symlink/);
    expect(existsSync(join(staged, "linked"))).toBe(false);
    expect(bindings).toEqual([]);
  },
);

test("creates generated bindings only in the disposable destination and validates script hashes", () => {
  const tree = temporaryTree(),
    destination = join(tree, "staged");
  const configHash = "12".repeat(28),
    claimHash = "34".repeat(28);

  bindTemplates(destination, configHash, claimHash);

  const generated = readFileSync(join(destination, "lib/ctvs/deployment.ak"), "utf8");

  expect(generated).toContain(`config_lock_hash: ByteArray =\n  #"${configHash}"`);
  expect(generated).toContain(`claim_hash: ByteArray =\n  #"${claimHash}"`);
  expect(() => bindTemplates(destination, "12", claimHash)).toThrow(/Invalid support-script hash/);
  expect(() => bindTemplates(destination, configHash, "zz".repeat(28))).toThrow(
    /Invalid support-script hash/,
  );
  expect(readFileSync(join(destination, "lib/ctvs/deployment.ak"), "utf8")).toBe(generated);
});
