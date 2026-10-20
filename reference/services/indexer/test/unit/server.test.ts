/** Exercise real status HTTP startup/shutdown and prove recovery never serves fabricated vault results. */
import { rmSync } from "node:fs";
import { expect, it } from "vitest";
import { startService } from "../../src/main.js";
import { setup } from "./fixtures.js";
import { sourceServer } from "./source-server.js";

it("serves status during reconciliation, becomes ready, retains unverified Kupo and closes cleanly", async () => {
  const f = setup();
  const upstream = await sourceServer(f.config);
  const config = {
    ...f.config,
    http: { host: "127.0.0.1", port: 0 },
    sources: { ogmios: upstream.url, kupo: upstream.url },
  };

  let initialize: () => void = () => {};

  const gate = new Promise<void>((resolve) => {
    initialize = resolve;
  });
  const controller = new AbortController();
  const service = await startService(config, controller.signal, async (_config, runner, signal) => {
    await gate;
    runner.intersect(config.intersection, config.intersection);

    if (!signal.aborted)
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
  });
  const address = service.server.address();

  if (!address || typeof address === "string") throw new Error("missing status listener");

  const url = `http://127.0.0.1:${address.port}`;

  try {
    expect((await fetch(`${url}/health/live`)).status).toBe(200);
    expect((await fetch(`${url}/health/ready`)).status).toBe(503);

    const status = await (await fetch(`${url}/status`)).json();

    expect(status.readerHead.slot).toBe("0");
    expect(status.readerReady).toBe(false);
    expect((await fetch(`${url}/vaults`)).status).toBe(404);
    expect((await fetch(`${url}/status`, { method: "POST" })).status).toBe(405);
    initialize();
    await gate;

    const ready = await fetch(`${url}/health/ready`);

    expect(ready.status).toBe(200);
    expect((await ready.json()).lookupReady).toBe(false);
  } finally {
    initialize();
    service.stop();
    await service.done;
    await upstream.close();
    rmSync(f.directory, { recursive: true });
  }
});
