/** Loads trusted installed packages; package admission and execution isolation remain application policy. */
import { readFile } from "node:fs/promises";
import type { NodePluginPackage, RuntimeImports } from "../../contract/component.js";
import { type BuiltinImport, wasiImports } from "./wasi.js";

function requireJspi(): void {
  const api = WebAssembly as typeof WebAssembly & { Suspending?: unknown; promising?: unknown };

  if (typeof api.Suspending !== "function" || typeof api.promising !== "function") {
    throw new Error(
      "this plugin requires native JSPI (WebAssembly.Suspending and WebAssembly.promising)",
    );
  }
}

export async function loadNodePlugin<Imports extends object, Exports extends object>(
  plugin: NodePluginPackage<Imports, Exports>,
  imports: Omit<RuntimeImports<Imports>, BuiltinImport>,
): Promise<Exports> {
  if (plugin.apiVersion !== "CTVS-NODE-PLUGIN-1") throw new Error("unsupported plugin package API");

  if (plugin.modules.protocol !== "file:" || !plugin.modules.href.endsWith("/")) {
    throw new Error("plugin modules must be an installed package directory");
  }

  if (plugin.requiresJspi) requireJspi();

  const builtins = wasiImports();

  if (Object.keys(imports).some((name) => name in builtins)) {
    throw new Error("plugin capabilities cannot replace built-in WASI imports");
  }

  const modules = new Map<string, Promise<WebAssembly.Module>>();

  const getCoreModule = (path: string): Promise<WebAssembly.Module> => {
    const url = new URL(path, plugin.modules);

    if (!url.href.startsWith(plugin.modules.href) || !url.pathname.endsWith(".wasm")) {
      throw new Error("core module must remain inside the installed plugin package");
    }

    let compiled = modules.get(url.href);

    if (!compiled) {
      compiled = readFile(url).then((bytes) => WebAssembly.compile(Uint8Array.from(bytes)));
      modules.set(url.href, compiled);
    }

    return compiled;
  };

  return plugin.instantiate(getCoreModule, { ...builtins, ...imports } as Imports);
}
