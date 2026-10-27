# Kupo deployment

This directory is the home for plugin-aware Kupo startup and deployment within the existing stack. Configuration validation, package resolution and collection settings are implemented as separate APIs with tests. Discovery orchestration and container startup remain unimplemented. The current [Compose stack](../compose.yml) still starts Kupo with fixed origin/wildcard coverage. Managed-storage recognition and native reuse-policy tests remain pending.

The reusable WASM loader, discovery wrapper, collection planner and bundled integrations stay in [`@ctvs/plugins`](../../../packages/plugins/README.md). The private `@ctvs/kupo-startup` workspace declares its own dependency on that package. Kupo startup will consume those APIs through its own container entrypoint. The existing indexer reader continues to use [`src/main.ts`](../src/main.ts), and its HTTP SDK remains stateless.

## Current structure

```text
kupo/
  README.md
  package.json
  config.example.json
  src/
    config.ts
    packages.ts
    package-cache.ts
    settings.ts
  test/
    config.test.ts
    packages.test.ts
    package-install.test.ts
    package-fixture.ts
    native-packages.ts
    settings.test.ts
```

## Planned implementation files

Add the remaining files as their behavior is implemented. Startup orchestration and container integration remain later stages.

| File | Responsibility | Status |
| --- | --- | --- |
| `Dockerfile` | Build the published Kupo startup image with the host runtime and bundled plugins | Pending |
| `entrypoint.sh` | Run preparation and launch Kupo with shutdown signals reaching the process | Pending |
| `config.example.json` | Show the single operator configuration with invalid network/asset placeholders | Implemented |
| `src/config.ts` | Validate startup configuration and deployment registrations | Implemented, reviewed |
| `src/packages.ts` | Resolve bundled/additional packages and provide the discovery importer | Implemented, reviewed |
| `src/package-cache.ts` | Install additional packages into complete, locked npm snapshots | Implemented, reviewed |
| `src/settings.ts` | Translate the combined collection plan into Kupo startup settings | Implemented, reviewed |
| `src/managed-storage.ts` | Recognize initialization ownership and refuse unsupported existing storage | Pending |
| `src/startup.ts` | Coordinate package resolution, discovery, planning and startup preparation | Pending |
| `test/` | Keep validation, installation and native Kupo checks beside their implementation | Unit tests implemented |

The existing [service Compose files](../README.md#complete-local-stack) remain the deployment definitions. The Kupo image has a separate execution path from the reader daemon. This workspace adds no runtime imports, dependencies, configuration fields or startup hooks to that daemon.

## Configuration contract

`parseKupoConfig(value)` validates an already parsed JSON value. `loadKupoConfig(filename)` reads and parses a JSON file, then applies the same validation. Neither function imports plugin implementations, installs packages, calls discovery or opens a database.

| Field | Rule |
| --- | --- |
| `network` | Required `networkId`, `networkMagic` and lowercase 32-byte `genesisHash`, using the shared network validator |
| `additionalPackages` | Optional package-name-to-exact-version map; defaults to an empty map |
| `registrations` | Required nonempty list with no registration-count limit, using the shared registration validator |
| Registration `deployment` | Plugin-owned object; the host preserves it without imposing protocol fields |

Unknown fields at the configuration, network and registration levels are rejected. Package names use the shared name validator. Versions must be canonical exact semantic versions; prerelease and build identifiers are accepted, while tags, ranges, aliases, URLs and local paths are rejected. Package installation and registration remain separate: listing an additional package does not create a registration, and several registrations can use one package. Returned configuration is detached from the input.

Copy [config.example.json](config.example.json) as a starting point. Its genesis placeholder deliberately fails host validation; its policy placeholder belongs to the fixture plugin's later deployment validation. The example uses the existing fixture plugin, whose deployment input includes its network and explicit collection rules; that shape is not imposed on other plugins. This parser does not verify that a named package is available or compatible, authenticate the mounted node, prove database coverage or start Kupo.

From `reference/`, run:

```sh
npm run check:typescript
npx vitest run --project unit services/indexer/kupo/test --reporter=default
```

The Kupo source and tests are included in the existing workspace typecheck, unit-test discovery and coverage configuration.

## Package resolution contract

`resolvePackages(config, options)` returns the `PackageImporter` accepted by `discoverPlugins`. It validates availability and resolves configured additional packages, but does not call a plugin's `open` or `discover`. The caller supplies the image's bundled package table, a persistent cache directory and an abort signal. Each bundled entry contains its exact version and a lazy `load()` function. There is no second operator registration file or production bundled catalog yet; the image composition belongs to Stage 6.

| Case | Behavior |
| --- | --- |
| Registered bundled package | Import lazily through the supplied loader; no installation |
| Additional pin matching a bundled version | Reuse the bundled package |
| Additional pin conflicting with a bundled version | Reject before installation; no shadowing |
| Registered package absent from both sources | Reject before installation |
| Configured additional package without a registration | Install it, but do not import or enable it |
| Repeated registrations for one package | Reuse one module; discovery still opens a fresh session per registration |

Custom packages are installed with npm into a temporary directory using exact top-level versions, production dependencies and disabled lifecycle scripts. The optional internal `registry` option defaults to `https://registry.npmjs.org/`; tests use a local fixture registry. Direct package identities must match the full requested pins before publication. Configuration accepts canonical build metadata, and bundled versions compare it exactly; npm may normalize it during registry resolution, in which case a differing installed version is rejected. The importer resolves ESM from the completed installation, including packages exposing only an `import` condition. It checks the installed package's name/version and the shared discovery descriptor before returning the module. Cancellation stops installation and prevents later imports through the returned importer. JavaScript wrapper code remains trusted; disabling installation scripts does not sandbox imported code.

The persistent cache contains npm's download cache and an `installs/<hash>/` directory for each additional-package set, registry and host platform/architecture/Node ABI. Package ordering and deployment settings do not change the installation identity. Successful installation publishes `package.json`, `package-lock.json`, `node_modules`, a fixed ESM resolver and a completion record together through an atomic directory rename. Concurrent installers reuse the first complete result.

Restarts validate the manifest, lockfile hash, completion record, resolver and installed dependency versions before reuse. Optional packages skipped by npm for the platform are distinguished from installed optional dependencies. These checks do not rehash every installed source or WASM file and do not provide package admission signatures. A changed or incomplete published cache fails without redownloading or silently resolving dependencies again. Failed or cancelled installs remove their own staging directory; abandoned staging directories from a crashed process are ignored and never promoted.

The first successful install locks its resolved transitive dependency tree, and a matching restart reuses it without contacting the registry. Exact top-level versions alone do not pin transitive ranges on a different empty volume. Preserve the completed installation for identical reuse on a compatible host; lockfile-based reconstruction/export is not implemented in this stage. Packages must ship the runtime assets they need without installation scripts. npm itself must be available on the host; container packaging remains pending.

Tests use real tarballs and npm against a temporary local registry, including import-only exports, multiple packages, prerelease versions, rejection of normalized build pins, offline reuse, dependency locking, script suppression, cancellation/retry, concurrent publication and refusal of damaged cache metadata. Native Node subprocess checks verify separate installations and package versions without relying on Vitest's bare-import cache. The bundled workspace example also runs through the existing JCO discovery adapter, with the existing unsupported-JSPI rejection on older runtimes. These tests establish the package boundary, not external WASM conformance or real Kupo startup.

## Collection settings contract

`kupoSettings(plan, profile?)` takes a validated `CollectionPlan` from `planCollections` and returns `since`, `spent`, `patterns` and the collection-only `arguments` array. It does not import plugins, query Kupo, open a database or launch a process. The returned metadata describes requested settings; it is not a coverage record or readiness result.

| Profile | Matching behavior | Intended consumer |
| --- | --- | --- |
| `shared-reader` (default) | Exactly `--match "*"` | The current stack, where the CTVS reader requires wildcard coverage |
| `plugins-only` (explicit) | One `--match` pair per sorted, distinct plugin pattern | A separate Kupo instance without that reader requirement |

Both profiles start with `--since origin` and retain spent outputs by omitting `--prune-utxo`. These initial settings are deliberately broader than later consumer start points and `unspent-sufficient` minima. Per-source starting points, pruning and selective retention are not introduced. `--defer-db-indexes` is also omitted. The original plan retains every consumer's starts and history requirements, but the initial managed-volume policy does not maintain a separate coverage ledger per plugin. Starting at origin does not authenticate declared chain-point assertions or recover history previously pruned from an existing database.

The shared profile emits only `"*"`, without redundant plugin patterns: the reader's current [Kupo probe](../src/chain/kupo-probe.ts) requires the runtime pattern list to contain exactly that one entry. The plugin-only profile preserves overlapping policy, asset, credential and address patterns; it performs no matcher-subsumption optimization. A plan with no collection rules is rejected in plugin-only mode rather than leaving Kupo's matching behavior implicit. The shared profile still has the reader's wildcard requirement in that case. No pattern-count limit is imposed.

For example, a plugin-only plan containing the same policy requirement from several registrations produces:

```ts
const settings = kupoSettings(plan, "plugins-only");
// settings.patterns: ["<policy-id>.*"]
// settings.arguments: ["--since", "origin", "--match", "<policy-id>.*"]
```

The arguments are discrete strings, not a shell command. Paths, node connection, work directory, listening options and process execution belong to later startup/container work. The profile is a host API choice, not a new field in the operator configuration. No Compose file or reader readiness rule is changed here. Using selective patterns with the current reader would fail its readiness check and is not a supported shared-stack deployment.

The pinned image `cardanosolutions/kupo@sha256:7d3c62368a4a5a609f5cf0ee6949eb8d491ed8f5a4d05b38da3213d95735f03b` reports `v2.12.0+491918`. Its `--help` confirms repeated `--match` arguments, `--since origin` and opt-in pruning. These help/version checks ran without network access or data mounts. They do not establish historical database coverage or replace Stage 6 container acceptance. The [upstream v2.12.0 release](https://github.com/CardanoSolutions/kupo/releases/tag/v2.12.0) identifies the same source revision.

## Database reuse policy

Managed-storage initialization and focused tests of Kupo's checkpoint, pattern-conflict and retention behavior remain pending. Kupo owns database schema creation, indexing and checkpoint resumption; startup must preserve unsupported existing data.

## Intended operator experience

- Provide one configuration file selecting deployments and any additional plugin packages.
- Run the published images through Compose without building an image or running a separate preparation command.
- Make bundled plugins available for registration and obtain configured custom packages before discovery.
- Run discovery, combine collection requirements, enforce the managed-volume reuse policy and launch Kupo with its own startup safeguards.

Only Kupo collection setup belongs here. Evidence selection, protocol decoding, projections and SDK plugin integration remain separate design work.

## Details to settle in later stages

- Review the Stage 4 managed initialization/reuse policy before adding startup orchestration.
- Finalize entrypoint orchestration, restart handling and shutdown behavior.
- Wire the guard before Kupo can open a database, preserve unsupported data and surface native Kupo startup errors.
- Preserve the shared-reader profile when wiring the existing stack. Any later selective shared-stack mode requires a separate change to the reader's [wildcard-only Kupo readiness contract](../src/chain/kupo-probe.ts) and its tests.
