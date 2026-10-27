import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { loadKupoConfig, parseKupoConfig } from "../src/config.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function config() {
  return {
    network: { networkId: 0, networkMagic: 42, genesisHash: "11".repeat(32) },
    registrations: [
      { id: "first", package: "@fixture/lending", deployment: { markets: ["a", "b"] } },
      { id: "second", package: "@fixture/lending", deployment: { positions: ["one", "two"] } },
      { id: "third", package: "@fixture/another", deployment: {} },
    ],
  };
}

it("accepts installed packages and multiple deployments without imposing a deployment schema", () => {
  const input = config();
  const parsed = parseKupoConfig(input);

  expect(parsed).toEqual({ ...input, additionalPackages: {} });
  input.network.networkMagic = 43;
  input.registrations[0]?.deployment.markets?.push("later");
  expect(parsed.network.networkMagic).toBe(42);
  expect(parsed.registrations[0]?.deployment).toEqual({ markets: ["a", "b"] });
});

it.each(["1.2.3", "0.0.0", "1.2.3-rc.1", "1.2.3+build.7", "1.2.3-rc.1+build.7"])(
  "accepts a canonical exact custom package version (%s)",
  (version) => {
    expect(
      parseKupoConfig({ ...config(), additionalPackages: { "@fixture/lending": version } })
        .additionalPackages,
    ).toEqual({ "@fixture/lending": version });
  },
);

it.each([
  "latest",
  "next",
  "^1.2.3",
  "~1.2.3",
  ">=1.2.3",
  "1",
  "1.2",
  "1.2.x",
  "*",
  "v1.2.3",
  "=1.2.3",
  " 1.2.3",
  "1.2.3 ",
  "01.2.3",
  "1.2.3-01",
  "npm:other@1.2.3",
  "file:../plugin",
  "https://example.invalid/plugin.tgz",
  "",
  null,
  123,
  {},
  [],
])("rejects an unpinned or malformed package version (%j)", (version) => {
  expect(() =>
    parseKupoConfig({ ...config(), additionalPackages: { "@fixture/lending": version } }),
  ).toThrow("canonical exact versions");
});

it("keeps additional package installation separate from deployment enablement", () => {
  const input = { ...config(), additionalPackages: { "@fixture/unused": "1.2.3" } };
  const parsed = parseKupoConfig(input);

  expect(parsed.additionalPackages).toEqual({ "@fixture/unused": "1.2.3" });
  expect(parsed.registrations).toEqual(config().registrations);
  input.additionalPackages["@fixture/unused"] = "2.0.0";
  expect(parsed.additionalPackages["@fixture/unused"]).toBe("1.2.3");
});

it("rejects malformed package maps and uses the shared package name validator", () => {
  for (const name of ["", "@scope", "Uppercase", "file:../plugin", "../plugin", "x".repeat(215)])
    expect(() => parseKupoConfig({ ...config(), additionalPackages: { [name]: "1.2.3" } })).toThrow(
      "npm package",
    );

  for (const additionalPackages of [null, [], "@fixture/lending@1.2.3"])
    expect(() => parseKupoConfig({ ...config(), additionalPackages })).toThrow("must be an object");
});

it("rejects missing or malformed network identities and unknown host configuration fields", () => {
  for (const network of [
    undefined,
    null,
    [],
    {},
    { ...config().network, networkId: 2 },
    { ...config().network, networkMagic: -1 },
    { ...config().network, networkMagic: 1.5 },
    { ...config().network, networkMagic: 0x1_0000_0000 },
    { ...config().network, genesisHash: "placeholder" },
    { ...config().network, genesisHash: "AB".repeat(32) },
    { ...config().network, typo: true },
  ])
    expect(() => parseKupoConfig({ ...config(), network })).toThrow();

  expect(() => parseKupoConfig({ ...config(), typo: true })).toThrow("unknown fields");

  for (const value of [undefined, null, [], "configuration"])
    expect(() => parseKupoConfig(value)).toThrow("must be an object");
});

it("reuses registration identity and size limits and rejects misspelled registration fields", () => {
  const first = config().registrations[0];

  if (!first) throw new Error("missing fixture registration");

  for (const registrations of [
    undefined,
    null,
    {},
    [],
    [first, first],
    [{ ...first, id: "" }],
    [{ ...first, package: "file:../plugin" }],
    [{ ...first, deployment: null }],
    [{ ...first, deployment: { text: "x".repeat(1_048_576) } }],
    [{ ...first, enabled: true }],
  ])
    expect(() => parseKupoConfig({ ...config(), registrations })).toThrow();
});

it("accepts more than 16 registrations and still checks every registration identity", () => {
  const registrations = Array.from({ length: 32 }, (_, index) => ({
    id: `deployment-${index}`,
    package: "@fixture/lending",
    deployment: { position: index },
  }));

  expect(parseKupoConfig({ ...config(), registrations }).registrations).toEqual(registrations);
  registrations.push({
    id: "deployment-0",
    package: "@fixture/lending",
    deployment: { position: 32 },
  });
  expect(() => parseKupoConfig({ ...config(), registrations })).toThrow("valid and unique");
});

it("reads configuration from JSON and reports missing files or invalid JSON before discovery", () => {
  const directory = mkdtempSync(join(tmpdir(), "ctvs-kupo-config-"));
  const filename = join(directory, "plugins.json");

  directories.push(directory);
  writeFileSync(filename, JSON.stringify(config()));
  expect(loadKupoConfig(filename)).toEqual(parseKupoConfig(config()));
  writeFileSync(filename, "{");
  expect(() => loadKupoConfig(filename)).toThrow(SyntaxError);
  expect(() => loadKupoConfig(join(directory, "missing.json"))).toThrow();
});

it("keeps the example's network placeholder invalid until the operator supplies the genesis hash", () => {
  const source = readFileSync(new URL("../config.example.json", import.meta.url), "utf8");

  expect(() => parseKupoConfig(JSON.parse(source))).toThrow();

  const edited = source
    .replaceAll("<sha256-of-original-shelley-genesis>", "11".repeat(32))
    .replaceAll("<56-lowercase-hex-policy-id>", "22".repeat(28));
  const parsed = parseKupoConfig(JSON.parse(edited));

  expect(parsed.registrations[0]?.package).toBe("@ctvs/example-plugin");
  expect(parsed.additionalPackages).toEqual({});
});
