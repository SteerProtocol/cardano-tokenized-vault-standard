/** Environment-driven daemon startup, bounded reconnects and orderly shutdown; no signing or submission. */
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { synchronize } from "./chain/ogmios.js";
import { type IndexerConfig, loadConfig } from "./config.js";
import { Runner } from "./runner.js";
import { closeServer, statusServer } from "./server.js";

async function monitorKupo(
  config: IndexerConfig,
  signal: AbortSignal,
  runner: Runner,
): Promise<void> {
  while (!signal.aborted) {
    await runner.kupo.check(runner.lookupTarget(), signal);

    try {
      await delay(config.limits.reconnectDelayMs, undefined, { signal });
    } catch {
      return;
    }
  }
}

/** Returns a status listener while the official chain source reconciles; failures close the daemon instead of serving fabricated data. */
export async function startService(
  config: IndexerConfig,
  parent: AbortSignal,
  source: typeof synchronize = synchronize,
) {
  const runner = new Runner(config);

  try {
    runner.restore();
  } catch (error) {
    runner.close();

    throw error;
  }

  const controller = new AbortController();
  const signal = AbortSignal.any([parent, controller.signal]);
  const server = await statusServer(config, runner).catch((error: unknown) => {
    runner.close();

    throw error;
  });
  const monitoring = monitorKupo(config, signal, runner);
  const done = (async () => {
    try {
      await source(config, runner, signal);
    } finally {
      controller.abort();

      try {
        await closeServer(server);
      } finally {
        await monitoring;
        runner.close();
      }
    }
  })();

  return { server, done, stop: () => controller.abort() };
}

export async function main(): Promise<void> {
  const filename = process.env.CTVS_INDEXER_CONFIG ?? resolve("config/indexer.json");
  const config = loadConfig(filename);
  const controller = new AbortController();

  const stop = () => controller.abort();

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    const service = await startService(config, controller.signal);

    console.log(
      JSON.stringify({ service: "ctvs-indexer", event: "started", statusPort: config.http.port }),
    );
    await service.done;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
    process.exit(0);
  } catch (error) {
    console.error(
      JSON.stringify({
        service: "ctvs-indexer",
        event: "failed",
        reason: error instanceof Error ? error.message : "startup failed",
      }),
    );
    process.exit(1);
  }
}
