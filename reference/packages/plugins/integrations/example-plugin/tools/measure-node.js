/** Fresh-process benchmark worker; invokes the same guest imports as the tests. */
import { readFileSync } from "node:fs";
import { nativeFailure, nativeSuccess } from "../test/fixtures/discovery.js";
import { discover, fetch as fetchThroughPlugin } from "../test/fixtures/plugin.js";

const input = JSON.parse(readFileSync(0, "utf8"));
const discoveries = input.discoveries.map(({ config, cursor, pageSize }) => {
  try {
    return nativeSuccess(discover(config, cursor, pageSize));
  } catch (error) {
    return nativeFailure(error.payload);
  }
});
const fetches = [];

for (const url of input.urls) {
  try {
    fetches.push({ ok: await fetchThroughPlugin(url) });
  } catch (error) {
    fetches.push({ error: error.payload });
  }
}

console.log(JSON.stringify({ discoveries, fetches }));
