/** Build each requested family separately so shared source does not imply a shared vault script. */

import { buildImplementation } from "./lib/build.js";
import { selectedImplementations } from "./lib/project.js";

for (const implementation of selectedImplementations(process.argv.slice(2)))
  buildImplementation(implementation);
