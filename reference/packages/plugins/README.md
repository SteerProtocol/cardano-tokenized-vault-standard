# WASM harness and Kupo collection planning

`@ctvs/plugins/indexer` provides the reusable Node loader for installed component packages. The first integration is the `@ctvs/example-plugin` workspace package. Both packages expose compiled JavaScript and TypeScript declarations through package exports. They remain private while the interface is developed.

```ts
import { loadNodePlugin } from "@ctvs/plugins/indexer";
import { examplePlugin } from "@ctvs/example-plugin";

const plugin = await loadNodePlugin(examplePlugin, {
  "ctvs:example-plugin/http": {
    get: async (url) => ({ status: 200, body: `example response for ${url}` }),
  },
});

const response = await plugin.fetch("http://fixture.invalid");
```

The package descriptor supplies JCO's generated `instantiate` function, its API/package version, required JSPI support, and an asset directory relative to the installed package. Consumers import package names; they never construct repository paths. Each load creates a fresh guest instance. Core modules are compiled once per load, even if JCO requests one repeatedly.

The loader supports the CLI/IO imports required by the current Rust guest. It supplies an empty environment and argument list, disables standard streams, and turns WASI exit into an exception. Other capabilities are provided explicitly by the caller. Missing imports fail instantiation. JCO preparation happens at package build time, so a consuming Node application does not need JCO or Rust at runtime.

This first loader is for explicitly installed, trusted packages in the Node process. It does not implement admission signatures, a remote catalog, worker isolation, guest interruption, or memory/fuel limits. Current work is limited to standalone WASM loading, collection discovery and planning for Kupo configuration. The CTVS indexer does not load these packages. The SDK entry point remains reserved.

## Development and packaging

Run from `reference/` with Rust's `wasm32-wasip2` target installed:

```sh
npm ci
npm run build:plugins
npm run test:plugins
npm test --workspace @ctvs/example-plugin
npm run test:plugins:package
```

The root workspace lockfile is canonical, including bundled integrations. Versioned dependencies such as `"@ctvs/plugins": "0.1.0"` resolve to the local workspace during development and use the same package names after publication. No `file:` or repository-relative dependency is required.

The package check creates real npm tarballs, installs them with production dependencies into a temporary directory outside the repository, typechecks a consumer, and executes discovery and an async import through the installed packages. It also resolves the portable component through `@ctvs/example-plugin/component`. Installation prefers npm's cache and may fetch missing registry metadata or production dependencies; lifecycle scripts remain disabled. The tarballs and temporary consumer are removed afterward; nothing is published.

JCO 1.39's generated declarations use versioned interface keys although its runtime expects unversioned imports, and omit the Promise on the selected HTTP import. The loader's `RuntimeImports` type and the example's small typed instantiation adapter reconcile these declarations. The isolated TypeScript consumer tests this boundary.

See the [example plugin](integrations/example-plugin/README.md) for the component contract and cross-host tests. The `@ctvs/plugins/indexer` package export is a standalone Node API; it does not install hooks in the CTVS indexer service.

## Multiple-plugin discovery and collection

An installed package exports `discoveryPlugin: DiscoveryPackage` alongside its direct component descriptor. The adapter has `apiVersion: "CTVS-DISCOVERY-PACKAGE-1"`, `name`, `version`, and `open(deployment, network, signal)`. Each `open` validates package-specific deployment settings and returns `discover(cursor, pageSize)`. The example adapter instantiates its WASM component through the reusable loader, binds its typed deployment input and disables its HTTP import. This Node package adapter preserves the component's existing WIT interface; it does not introduce a new universal deployment ABI or change the Wasmtime runner.

```ts
import { discoverPlugins, planCollections } from "@ctvs/plugins/indexer";

const discovered = await discoverPlugins(registrations, network, signal,
  (name) => import(name)); // Resolve installed dependencies from the application.
const plan = planCollections(network, discovered);
```

The wrapper imports each package once per run and opens a fresh session per registration. Shared page validation enforces the network, canonical match/start encodings, minimum history and bounded pagination. The planner shares identical matchers while retaining every consumer's registration ID, source label, replay start and minimum history. Source names are local to a registration. Collection labels provide attribution of requirements, not an evidence selection interface. `discoveryPackage(module, name)` exposes the same descriptor validation used by discovery so a supplying importer can check identity and compatibility before returning a module. Enabled packages are trusted executable Node packages; `discoverPlugins` itself never installs packages or provides isolation.

The wrapper has no registration-count limit. Each registration is limited to 1 MiB of deployment JSON, 64 pages of 256 rules and 16 MiB of discovery pages. These are declaration bounds; they do not provide guest CPU or memory isolation.

The intended setup flow is enabled plugins, discovery, combined collection requirements, then Kupo configuration. The collection plan is input for that configuration. It does not execute queries, retrieve outputs or decode protocol data. Current origin/wildcard Compose settings are unchanged. Indexer startup integration, evidence selection, bounded consistent data access, decoding and SDK integration are deferred. Discovery rules do not define those interfaces.

Kupo deployment lives beside the stack in [`services/indexer/kupo/`](../../services/indexer/kupo/README.md). Its separate workspace implements configuration validation, package provisioning and collection settings generation. Its package resolver supplies an importer for bundled and additional packages; the reusable loader, discovery wrapper and collection planner remain in this package. Discovery orchestration and container startup remain pending. The resolver is not wired into the reader daemon or Compose startup.
