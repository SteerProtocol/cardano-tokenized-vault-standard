import { examplePlugin } from "@ctvs/example-plugin";
import { loadNodePlugin } from "@ctvs/plugins/indexer";
import { get } from "../../host/node/http.js";

export const { discover, fetch } = await loadNodePlugin(examplePlugin, {
  "ctvs:example-plugin/http": { get },
});
