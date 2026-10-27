/** Package-relative assets and JCO instantiation bindings for direct and discovery consumers. */
import { type ImportObject, instantiate, type Response } from "./js/example-plugin.js";

type ExampleImports = Omit<ImportObject, "ctvs:example-plugin/http@0.1.0"> & {
  "ctvs:example-plugin/http@0.1.0": { get(url: string): Response | Promise<Response> };
};

// JCO 1.39's declarations omit the Promise selected by --async-imports.
function instantiateExample(
  getCoreModule: (path: string) => Promise<WebAssembly.Module>,
  imports: ExampleImports,
) {
  return instantiate(getCoreModule, imports as ImportObject);
}

export const examplePlugin = {
  apiVersion: "CTVS-NODE-PLUGIN-1" as const,
  name: "@ctvs/example-plugin",
  version: "0.1.0",
  requiresJspi: true,
  modules: new URL("./js/", import.meta.url),
  instantiate: instantiateExample,
};
