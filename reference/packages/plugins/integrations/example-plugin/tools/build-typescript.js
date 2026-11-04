/** Componentize emitted JavaScript against the Rust example's unchanged WIT world. */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { componentize } from "@bytecodealliance/componentize-js";
import { _setPreopens } from "@bytecodealliance/preview2-shim/filesystem";

// The build tool needs only the shared WIT directory, never the whole filesystem.
_setPreopens({ "/wit": fileURLToPath(new URL("../plugin/wit", import.meta.url)) });

const { component } = await componentize({
  sourcePath: fileURLToPath(new URL("../dist/typescript/guest/index.js", import.meta.url)),
  witPath: "/wit",
  worldName: "plugin",
  disableFeatures: ["stdio", "random", "clocks", "http", "fetch-event"],
});

await writeFile(new URL("../dist/typescript/plugin.wasm", import.meta.url), component);
