/** The custom WIT capability, supplied by either host; no guest networking runtime. */
declare module "ctvs:example-plugin/http@0.1.0" {
  export function get(
    url: string,
  ): import("../dist/js/interfaces/ctvs-example-plugin-http.js").Response;
}
