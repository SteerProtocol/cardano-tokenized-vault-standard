/** Assembled-image acceptance; discovery prepares collection, never evidence queries or SDK state. */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";
import { eventually } from "../../../test/node/support/environment.js";
import { Cleanup } from "../../../test/support/cleanup.js";
import { composeFixture } from "./compose-fixture.js";
import { docker, snapshot } from "./kupo-fixture.js";

let cleanup: Cleanup;

beforeEach(() => {
  cleanup = new Cleanup();
});
afterEach(async () => {
  await cleanup.close();
});

it("uses the same startup image, configuration and persistent cache in both Compose modes", async () => {
  const f = await composeFixture(cleanup);
  const existing = fileURLToPath(new URL("../../../compose.existing-node.yml", import.meta.url));
  const definitions = [
    await f.compose("config", "--format", "json"),
    await docker([
      "compose",
      "--env-file",
      join(f.root, "stack.env"),
      "-f",
      existing,
      "config",
      "--format",
      "json",
    ]),
  ];

  for (const definition of definitions) {
    const service = JSON.parse(definition).services.kupo;

    expect(service.command ?? null).toBeNull();
    expect(service.build.dockerfile).toBe("services/indexer/kupo/Dockerfile");
    expect(service.volumes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: "/configuration", read_only: true }),
        expect.objectContaining({ target: "/kupo-db", type: "volume" }),
        expect.objectContaining({ target: "/plugin-cache", type: "volume" }),
      ]),
    );
  }
});

it("starts bundled/custom discovery through Compose, indexes real outputs and restarts offline", async () => {
  const f = await composeFixture(cleanup);
  const stopRegistry = await f.additionalPlugin();

  await f.save();
  await f.compose("up", "-d", "--no-build", "node", "kupo");
  await f.ready();
  expect(await f.logs()).toContain("custom discovery package loaded");
  expect(await docker(["exec", f.name, "kupo", "--version"])).toBe("v2.12.0+491918");
  expect(await docker(["exec", f.name, "node", "--version"])).toBe("v26.12.1");
  expect(await docker(["exec", f.name, "readlink", "/proc/1/exe"])).toBe("/usr/local/bin/kupo");

  const address = f.fund();
  const port = await f.compose("port", "kupo", "1442");

  await eventually(async () => {
    const response = await fetch(`http://${port}/matches/${address}?unspent`);

    return response.ok && (await response.json()).length >= 3 ? true : undefined;
  }, "ordinary outputs through assembled Kupo");
  await f.compose("stop", "-t", "10", "kupo");
  // The pinned stock Kupo also returns 255 for SIGINT; preserve that native status.
  expect(await f.state()).toMatchObject({ Running: false, ExitCode: 255, OOMKilled: false });
  await f.inspectStorage();

  const before = snapshot(f.data);
  const marker = await readFile(join(f.data, ".ctvs-kupo.json"));
  const installs = await readdir(join(f.cache, "installs"));

  expect(before.patterns).toEqual([{ pattern: "*" }]);
  expect(before.checkpoints.length).toBeGreaterThan(0);
  expect(before.inputs.length).toBeGreaterThanOrEqual(3);
  expect(installs).toHaveLength(1);
  await stopRegistry();
  // A new process rereads both registrations and reuses its complete cache with the registry down.
  f.bundled.id = "bundled-after-restart";
  await f.save();
  await f.compose("up", "-d", "--no-build", "--no-deps", "kupo");
  await f.ready();
  await f.compose("stop", "-t", "10", "kupo");
  expect(await f.state()).toMatchObject({ Running: false, ExitCode: 255, OOMKilled: false });
  await f.inspectStorage();
  expect(snapshot(f.data).inputs).toEqual(before.inputs);
  expect(snapshot(f.data).patterns).toEqual(before.patterns);
  expect(await readFile(join(f.data, ".ctvs-kupo.json"))).toEqual(marker);
  expect(await readdir(join(f.cache, "installs"))).toEqual(installs);
});

it.each(["network", "discovery", "storage"] as const)(
  "refuses incompatible %s before opening Kupo's database",
  async (failure) => {
    const f = await composeFixture(cleanup);

    if (failure === "network") f.config.network.genesisHash = "00".repeat(32);

    if (failure === "discovery") f.bundled.deployment.rules = [{}];

    if (failure === "storage") await f.unownedStorage();

    await f.save();
    await f.compose("up", "-d", "--no-build", "--no-deps", "kupo");
    await eventually(
      async () => (!(await f.state()).Running ? true : undefined),
      "startup refusal",
    );
    expect((await f.state()).ExitCode).toBe(1);
    expect(await f.logs()).toContain(
      {
        network: "network identity mismatch",
        discovery: "expected an object",
        storage: "fresh empty directory",
      }[failure],
    );
    await f.inspectStorage();
    expect(await readdir(f.data)).toEqual(failure === "storage" ? ["unowned"] : []);

    if (failure === "storage")
      expect(await readFile(join(f.data, "unowned"), "utf8")).toBe("preserve me");
  },
);
