/** Install real tarballs outside the workspace and exercise only their public exports. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const directory = mkdtempSync(join(tmpdir(), "ctvs-plugin-consumer-"));

function run(command, args, cwd = directory) {
  return execFileSync(command, args, { cwd, encoding: "utf8", timeout: 60000 });
}

try {
  const tarballs = ["@ctvs/plugins", "@ctvs/example-plugin"].map((name) => {
    const result = JSON.parse(
      run(
        "npm",
        [
          "pack",
          "--workspace",
          name,
          "--json",
          "--ignore-scripts",
          "--pack-destination",
          directory,
        ],
        root,
      ),
    );

    return join(directory, result[0].filename);
  });

  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify({ name: "plugin-consumer", private: true, type: "module" }),
  );
  run("npm", [
    "install",
    "--prefer-offline",
    "--ignore-scripts",
    "--omit=dev",
    "--no-audit",
    "--no-fund",
    ...tarballs,
  ]);

  const usage = `
import { examplePlugin } from "@ctvs/example-plugin";
import { discoverPlugins, loadNodePlugin, planCollections } from "@ctvs/plugins/indexer";

const plugin = await loadNodePlugin(examplePlugin, {
  "ctvs:example-plugin/http": { get: async () => ({ status: 200, body: "packaged" }) },
});
const response = await plugin.fetch("http://fixture.invalid");
const page = plugin.discover({
  network: { networkId: 0, networkMagic: 42, genesisHash: "11".repeat(32) },
  rules: [],
}, undefined, 256);
const network = { networkId: 0, networkMagic: 42, genesisHash: "11".repeat(32) };
const discovered = await discoverPlugins([
  { id: "one", package: "@ctvs/example-plugin", deployment: { network, rules: [] } },
  { id: "two", package: "@ctvs/example-plugin", deployment: { network, rules: [] } },
], network, new AbortController().signal);
const plan = planCollections(network, discovered);
`;

  writeFileSync(
    join(directory, "consumer.ts"),
    `${usage}\nconst body: string = response.body;\nconst magic: number = page.network.networkMagic;\nvoid body; void magic;\n`,
  );
  writeFileSync(
    join(directory, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
      },
      files: ["consumer.ts"],
    }),
  );
  run(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"]);

  writeFileSync(
    join(directory, "consumer.js"),
    `
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
${usage}
assert.deepEqual(response, { status: 200, body: "packaged" });
assert.deepEqual(page.rules, []);
assert.deepEqual(plan.registrations.map((registration) => registration.id), ["one", "two"]);
assert.deepEqual(plan.collections, []);
const component = await readFile(new URL(import.meta.resolve("@ctvs/example-plugin/component")));
assert.deepEqual([...component.subarray(0, 8)], [0, 97, 115, 109, 13, 0, 1, 0]);
`,
  );
  run(process.execPath, ["consumer.js"]);
  console.log(
    "Packed packages pass isolated TypeScript, discovery, async import, and component asset checks.",
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
