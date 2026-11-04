import { loadNodePlugin } from "@ctvs/plugins/indexer";
import { get } from "../../host/node/http.js";
import { descriptor } from "./guest.js";

export const { discover, fetch } = await loadNodePlugin(descriptor, {
  "ctvs:example-plugin/http": { get },
});
