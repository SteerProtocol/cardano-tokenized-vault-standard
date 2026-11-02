import { examplePlugin } from "@ctvs/example-plugin";
import { loadNodePlugin, type NodePluginPackage } from "@ctvs/plugins/indexer";
import { afterEach, expect, it, vi } from "vitest";

const jspi = "Suspending" in WebAssembly && "promising" in WebAssembly;
const imports = {
  "ctvs:example-plugin/http": { get: async () => ({ status: 200, body: "injected capability" }) },
};

afterEach(() => vi.unstubAllGlobals());

it("loads fresh instances through package exports and injects an async capability", async () => {
  if (!jspi) {
    await expect(loadNodePlugin(examplePlugin, imports)).rejects.toThrow("requires native JSPI");

    return;
  }

  const first = await loadNodePlugin(examplePlugin, imports);
  const second = await loadNodePlugin(examplePlugin, {
    "ctvs:example-plugin/http": { get: async () => ({ status: 201, body: "second instance" }) },
  });

  expect(first.discover).not.toBe(second.discover);
  expect(await first.fetch("http://fixture.invalid")).toEqual({
    status: 200,
    body: "injected capability",
  });
  expect(await second.fetch("http://fixture.invalid")).toEqual({
    status: 201,
    body: "second instance",
  });
  expect(
    first.discover(
      { network: { networkId: 0, networkMagic: 42, genesisHash: "11".repeat(32) }, rules: [] },
      undefined,
      256,
    ).rules,
  ).toEqual([]);
});

function probe(
  instantiate: NodePluginPackage<Record<string, unknown>, object>["instantiate"],
): NodePluginPackage<Record<string, unknown>, object> {
  return {
    apiVersion: "CTVS-NODE-PLUGIN-1",
    name: "test",
    version: "0.1.0",
    requiresJspi: false,
    modules: new URL("file:///installed/plugin/"),
    instantiate,
  };
}

it("denies inherited process environment, standard IO and process exit", async () => {
  const plugin = probe((_getCoreModule, capabilities) => {
    const environment = capabilities["wasi:cli/environment"] as {
      getEnvironment(): unknown;
      getArguments(): unknown;
      initialCwd(): unknown;
    };
    const exit = capabilities["wasi:cli/exit"] as { exit(): void };
    const stdout = capabilities["wasi:cli/stdout"] as { getStdout(): void };

    expect(environment.getEnvironment()).toEqual([]);
    expect(environment.getArguments()).toEqual([]);
    expect(environment.initialCwd()).toBeUndefined();
    expect(() => exit.exit()).toThrow("WASI exit");
    expect(() => stdout.getStdout()).toThrow("standard IO");

    return {};
  });

  await loadNodePlugin(plugin, {});
  await expect(loadNodePlugin(plugin, { "wasi:cli/environment": {} })).rejects.toThrow(
    "cannot replace",
  );
});

it("rejects remote assets and paths escaping the installed package", async () => {
  const plugin = probe(async (getCoreModule) => ({
    module: await getCoreModule("../escape.wasm"),
  }));

  await expect(loadNodePlugin(plugin, {})).rejects.toThrow("inside the installed plugin package");
  await expect(
    loadNodePlugin({ ...plugin, modules: new URL("https://example.invalid/") }, {}),
  ).rejects.toThrow("installed package directory");
  await expect(
    loadNodePlugin({ ...plugin, apiVersion: "unknown" } as unknown as typeof plugin, {}),
  ).rejects.toThrow("unsupported plugin package API");
});

it("fails before instantiation when required JSPI APIs are unavailable", async () => {
  const api = Object.create(WebAssembly);

  Object.defineProperty(api, "Suspending", { value: undefined });
  vi.stubGlobal("WebAssembly", api);

  const instantiate = vi.fn(() => ({}));
  const plugin = { ...probe(instantiate), requiresJspi: true };

  await expect(loadNodePlugin(plugin, {})).rejects.toThrow("requires native JSPI");
  expect(instantiate).not.toHaveBeenCalled();
});
