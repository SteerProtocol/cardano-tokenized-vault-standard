/** Select the guest artifact; both languages use the same host imports and assertions. */
import { examplePlugin } from "@ctvs/example-plugin";

export const language = process.env.EXAMPLE_PLUGIN_GUEST ?? "rust";

if (language !== "rust" && language !== "typescript") throw new Error("unknown example guest");

export const component = new URL(
  language === "rust" ? "../../dist/plugin.wasm" : "../../dist/typescript/plugin.wasm",
  import.meta.url,
);

export const descriptor =
  language === "rust"
    ? examplePlugin
    : {
        ...examplePlugin,
        modules: new URL("../../dist/typescript/js/", import.meta.url),
        instantiate: (await import("../../dist/typescript/js/example-plugin.js")).instantiate,
      };
