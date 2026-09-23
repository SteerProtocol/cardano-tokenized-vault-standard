/** Check canonical authored Aiken sources; disposable staging and vendor copies are not editable inputs. */

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { compiler, referenceRoot } from "./lib/project.js";

execFileSync(
  compiler,
  [
    "fmt",
    "--check",
    ...["packages/onchain", "implementations/ctvs1/onchain", "implementations/ctvs2/onchain"].map(
      (path) => join(referenceRoot, path),
    ),
  ],
  { stdio: "inherit" },
);
