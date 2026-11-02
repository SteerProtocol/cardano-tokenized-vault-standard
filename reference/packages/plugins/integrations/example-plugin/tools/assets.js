import { copyFile } from "node:fs/promises";

await copyFile(
  new URL("../plugin/target/wasm32-wasip2/release/example_plugin.wasm", import.meta.url),
  new URL("../dist/plugin.wasm", import.meta.url),
);
