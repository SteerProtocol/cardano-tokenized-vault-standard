/** Installed package descriptor for JCO's generated instantiation output. */
export interface NodePluginPackage<Imports extends object, Exports extends object> {
  apiVersion: "CTVS-NODE-PLUGIN-1";
  name: string;
  version: string;
  requiresJspi: boolean;
  modules: URL;
  instantiate(
    getCoreModule: (path: string) => Promise<WebAssembly.Module>,
    imports: Imports,
  ): Exports | Promise<Exports>;
}

type RuntimeName<Name> = Name extends `${infer Plain}@${string}` ? Plain : Name;

/** JCO 1.39 declares versioned/type-only imports although its runtime uses unversioned value imports. */
export type RuntimeImports<Imports extends object> = {
  [Name in keyof Imports as Imports[Name] extends (...args: never[]) => unknown
    ? RuntimeName<Name>
    : keyof Imports[Name] extends never
      ? never
      : RuntimeName<Name>]: Imports[Name];
};
