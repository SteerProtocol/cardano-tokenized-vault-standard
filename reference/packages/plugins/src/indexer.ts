/** Node loading entry point for installed component packages. */
export type { NodePluginPackage } from "./contract/component.js";
export type {
  CollectionMatch,
  CollectionPoint,
  CollectionRule,
  CollectionStart,
  DiscoveredRegistration,
  DiscoveryPackage,
  NetworkIdentity,
  PluginRegistration,
} from "./contract/discovery.js";
export {
  collectionRule,
  networkIdentity,
  pluginPackageName,
  pluginRegistrations,
  sameNetwork,
} from "./contract/discovery.js";
export { loadNodePlugin } from "./host/node/loader.js";
export type { CollectionPlan } from "./indexer/collection.js";
export { kupoPattern, planCollections } from "./indexer/collection.js";
export type { PackageImporter } from "./indexer/discovery.js";
export { discoverPlugins, discoveryPackage } from "./indexer/discovery.js";
