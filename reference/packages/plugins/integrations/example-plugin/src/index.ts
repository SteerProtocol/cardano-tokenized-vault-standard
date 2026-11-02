/** Installed package exports; consumers never traverse the repository for generated assets. */
export { examplePlugin } from "./component.js";
export { discoveryPlugin } from "./discovery.js";
export type { DiscoveryPageV1, ExampleDeployment } from "./js/example-plugin.js";
export type { CollectionRule } from "./js/interfaces/ctvs-example-plugin-discovery-types.js";
