/** Public WIRE-2 datum/action codecs and identity helpers shared by the two implementation families. */
export * from "./actions.js";
export * from "./decode-actions.js";
export {
  addressData,
  assetData,
  assetFromData,
  assetId,
  credentialData,
  destinationData,
  destinationFromData,
  enterprise,
  MAGIC,
  NAMES,
  outputIndex,
  outRefData,
  outRefFromData,
  refId,
  sortedReferences,
  TERMS_DOMAIN,
} from "./primitives.js";
export * from "./recovery-cbor.js";
export * from "./requests.js";
export * from "./state.js";
export * from "./terms.js";
