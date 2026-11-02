# Example plugin

Rust WebAssembly component exercised through JCO in Node.js and a Wasmtime Rust runner, including structured collection discovery and asynchronous HTTP fetching.

Both hosts use the same component build and WIT contract. This remains an example, separate from the production harness.

The example is now the `@ctvs/example-plugin` npm workspace. Its public entry point exports a package descriptor for `loadNodePlugin` from `@ctvs/plugins/indexer`. Generated bindings use JCO's instantiation mode; the caller supplies HTTP capabilities instead of importing a fixed HTTP implementation. The portable component is exported as `@ctvs/example-plugin/component`.

```text
plugin/
  Cargo.toml
  wit/world.wit      Exports and HTTP import
  wit/discovery.wit  Discovery records, variants, and errors
  src/lib.rs         Component entry points
  src/discovery.rs   Stateless fixture pagination
src/index.ts         Public package exports and types
src/component.ts     Package-relative JCO descriptor
src/discovery.ts     Shared Node discovery adapter, with fixture-specific input validation
host/
  node/http.js       JavaScript GET import
  rust/              Wasmtime runner and Rust GET import
test/
  component.test.js  Component and JavaScript binding checks
  hosts.test.js      Cross-host discovery and async HTTP checks
  fixtures/http.js   Local HTTP server shared by both hosts
  fixtures/discovery.js
                    Shared records and native-runner transport conversion
```

## Interface

The [WIT world](plugin/wit/world.wit) uses the records and variants defined in [discovery.wit](plugin/wit/discovery.wit):

```wit
package ctvs:example-plugin@0.1.0;

interface http {
    record response {
        status: u16,
        body: string,
    }

    get: func(url: string) -> result<response, string>;
}

world plugin {
    import http;
    use http.{response};
    use discovery-types.{example-deployment, discovery-page-v1, discovery-error};

    export discover: func(
        config: example-deployment,
        cursor: option<string>,
        page-size: u32
    ) -> result<discovery-page-v1, discovery-error>;
    export fetch: func(url: string) -> result<response, string>;
}
```

### Collection discovery

Each discovery page contains:

| Field | Meaning |
| --- | --- |
| `schema` | The literal `CTVS-DISCOVERY-1` |
| `network` | Network ID, network magic, and genesis hash |
| `rules` | Collection rules with a local source label, structured match, replay start, and minimum history requirement |
| `nextCursor` | Continuation offset, or no value when all declared rules have been returned |

The match variants are `address`, `payment-credential`, `policy`, and `asset`. Replay starts at `origin` or a chain point; the required output creation must follow that intersection. Slots remain decimal strings to preserve values beyond JavaScript's safe integer range. History is `unspent-sufficient` or `spent-required`; these are minimum requirements, not instructions to discard other consumers' history. Rules form a union of collection requirements. A match establishes candidates, not vault ownership or complete accounting.

WIT variants appear in generated JavaScript as `{ tag, val }`, with camelCase record fields. An absent WIT option is `undefined` in these bindings; the earlier logical TypeScript proposal used `null`. Failed results throw an error whose `payload` contains a discovery error code and message.

The example takes an explicit network and list of rules in `example-deployment` to exercise the component boundary. This is fixture input, not a mandatory deployment configuration for real protocols. A protocol plugin would derive rules from its own deployment settings.

Page sizes must be 1..256. Pass `undefined` for the first cursor, then the returned `nextCursor` until it is `undefined`. Cursors are canonical decimal offsets into unchanged fixture input. Malformed/out-of-range cursors, invalid page sizes, and network IDs other than 0 or 1 return separate structured errors. Empty discovery returns an empty terminal page and never implies wildcard collection. The fixture has no pagination state shared between calls.

The consuming host must pin the loaded package and deployment configuration for the whole run, enforce byte and total-run budgets, reject repeated cursors, and validate canonical hashes/decimals and real addresses. The shared Node discovery wrapper supplies these declaration checks. Kupo deployment owns the translation into collection settings and the database reuse policy. The package's `discoveryPlugin` export adapts the typed guest to that wrapper; direct `loadNodePlugin` calls still require caller validation. A terminal discovery page means all declared rules were returned, not that collection is ready or the vault's portfolio is complete. The fixture passes its full input on each call for boundary testing; it is not a production throughput benchmark.

### Asynchronous HTTP

`fetch` calls the host's GET import and returns its status and text body. In the cross-host tests, HTTP statuses, including errors and redirects, are returned as responses; redirects are not followed. Transport failures become the WIT error string `fetch-failed`, and both test imports use a five-second request deadline. Applications supply their own HTTP implementation to the loader. This is a text-only, GET-only example, not a production HTTP policy or a finalized CTVS capability.

The guest implementation and WIT functions remain synchronous. The host suspends execution during I/O: JCO uses JSPI for the selected import and export, while Wasmtime uses async component calls and an async host import backed by reqwest. This example does not require WIT futures or WASI Preview 3.

## Build and test

Run these commands from `reference/` with Rust and a Node.js release that provides native JSPI (`WebAssembly.Suspending` and `WebAssembly.promising`):

```sh
rustup target add wasm32-wasip2
npm ci
npm run build:plugins
npm test --workspace @ctvs/example-plugin
```

Validated on macOS arm64 with Rust 1.95.0, Node.js 26.12.1, JCO 1.39.0, preview2-shim 0.30.0, and Wasmtime 36.0.19 from its LTS release line. The Rust runner uses the existing compiler without requiring a toolchain upgrade. Cargo and npm lockfiles retain the dependency versions.

The example's `npm test` builds the component once, generates JavaScript bindings with JCO's JSPI and instantiation options, builds the package facade and Wasmtime runner, and runs ten tests through the reusable Node loader and Rust host. It requires permission to bind an ephemeral loopback HTTP port. The root workspace lockfile covers this package; the JavaScript component tests run separately from the root Vitest projects.

The tests verify:

- Component output and all four collection match variants, both replay starts and history requirements, Unicode source labels, and exact slots above JavaScript's safe integer range.
- 10,001 rules over 40 bounded pages without loss or duplication, empty discovery, independent deployment calls, and structured cursor/page-size/network errors.
- Matching structured discovery pages and errors through JCO and Wasmtime, including the first and final pages of the large fixture, with the Rust runner reporting the component hash.
- Matching delayed UTF-8 bodies, 404 responses, redirects without following them, and dropped-connection errors from one local server.
- A JavaScript Promise from the guest fetch export and heartbeat progress in Node.js and a single-thread Tokio runtime while guest calls await HTTP.

To build without running tests:

```sh
npm run build:package --workspace @ctvs/example-plugin
```

The outputs are:

- `plugin/target/wasm32-wasip2/release/example_plugin.wasm`: the portable component.
- `dist/js/`: generated JavaScript bindings and core WebAssembly assets for JavaScript hosts.
- `dist/index.js` and declarations: public package entry point; `dist/plugin.wasm`: the portable component included in the npm bundle.
- `host/rust/target/debug/example-plugin-host`: the local Wasmtime test runner. It reads a JSON object containing `component`, `discoveries`, and `urls` from stdin and writes results as JSON. Each discovery call supplies `config`, `cursor`, and `page_size` using the generated Rust types' Serde representation. The [shared fixture](test/fixtures/discovery.js) translates the JavaScript representation for this local stdin/stdout transport; WIT remains the portable component contract.

For example, after building:

```js
import { examplePlugin } from "@ctvs/example-plugin";
import { loadNodePlugin } from "@ctvs/plugins/indexer";

const plugin = await loadNodePlugin(examplePlugin, {
  "ctvs:example-plugin/http": {
    get: async (url) => {
      try {
        const response = await fetch(url, {
          redirect: "manual",
          signal: AbortSignal.timeout(5000),
        });
        return { status: response.status, body: await response.text() };
      } catch {
        throw "fetch-failed";
      }
    },
  },
});

const config = {
  network: {
    networkId: 0,
    networkMagic: 42,
    genesisHash: "11".repeat(32),
  },
  rules: [{
    source: "positions",
    match: { tag: "policy", val: "22".repeat(28) },
    from: { tag: "origin" },
    history: "spent-required",
  }],
};

const page = plugin.discover(config, undefined, 256);
console.log(page.schema, page.rules, page.nextCursor);
// Supply an HTTP URL served by your own local test server.
const response = await plugin.fetch("http://127.0.0.1:8080/evidence");
```

`wasm32-wasip2` produces a component directly; no additional component-wrapping command is required. JCO translates that artifact into JavaScript bindings and core WASM; Wasmtime loads the component directly with bindings generated from the same WIT file. The JavaScript HTTP import throws the WIT error payload for JCO to translate, while Rust returns a `Result`.

JCO's JSPI mode is still documented as experimental in the [upstream transpilation documentation](https://bytecodealliance.github.io/jco/transpiling.html). The tests establish the selected path in the recorded Node.js version. Browser execution, HTTPS/TLS parity, cancellation behavior, resource limits, and production isolation remain outside this example. The Rust HTTP client is built without TLS features because these fixtures use local HTTP. The package is exercised through standalone discovery and collection planning tests. It is not loaded by the CTVS indexer. Applying Kupo configuration, indexer integration, protocol projections and SDK integration remain pending.
