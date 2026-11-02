/** Actual server identity and intersection errors must stop an isolated production runner before publishing history. */
import { join } from "node:path";
import { expect } from "vitest";
import { synchronize } from "../../../../src/chain/ogmios.js";
import { Runner } from "../../../../src/runner.js";
import { write } from "../../support/environment.js";
import type { Flow } from "../../support/flow.js";

export async function sourceRefusals(f: Flow) {
  const results = [];

  for (const mode of ["unavailable-intersection", "wrong-network"] as const) {
    const config = {
      ...f.env.config,
      database: join(f.env.directory, `g1-${mode}.sqlite`),
      sources: { ...f.env.config.sources, ogmios: "http://127.0.0.1:19007" },
      ...(mode === "unavailable-intersection"
        ? { intersection: { slot: 0n, blockHash: "ff".repeat(32) } }
        : { network: { ...f.env.config.network, networkMagic: 43 } }),
    };
    const runner = new Runner(config);

    runner.restore();

    try {
      await expect(synchronize(config, runner, AbortSignal.timeout(10000))).rejects.toThrow();

      const result = { mode, status: runner.status(), intentionallyInvalidConfiguration: true };

      expect(result.status.phase).toBe("failed");
      expect(result.status.readerReady).toBe(false);
      expect(result.status.history.blocks).toBe(0);
      expect(result.status.readerHead).toEqual(config.intersection);
      expect(() => runner.read((reader) => reader.counts)).toThrow("not ready");
      results.push(result);
    } finally {
      runner.close();
    }
  }

  write(f.env.directory, "g1-source-refusals", results);

  return results;
}
