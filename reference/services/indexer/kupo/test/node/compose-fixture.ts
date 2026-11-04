/** Test-owned Compose stack using the production Kupo entrypoint and a disposable producer. */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { eventually } from "../../../test/node/support/environment.js";
import { fund, generate } from "../../../test/node/support/prepare.js";
import type { Cleanup } from "../../../test/support/cleanup.js";
import type { KupoConfig } from "../../src/config.js";
import { adapterSource, registryFixture } from "../package-fixture.js";
import { docker } from "./kupo-fixture.js";

const startupImage = process.env.CTVS_KUPO_TEST_IMAGE ?? "ctvs-kupo:stage6";

const composePath = fileURLToPath(new URL("../../../compose.yml", import.meta.url));

async function configuration(root: string) {
  const network = generate(root, false, 100);
  const genesis = await readFile(join(network, "genesis/shelley-genesis.json"));
  const identity = {
    networkId: 0,
    networkMagic: 42,
    genesisHash: createHash("sha256").update(genesis).digest("hex"),
  };
  const bundled: KupoConfig["registrations"][number] = {
    id: "bundled",
    package: "@ctvs/example-plugin",
    deployment: {
      network: identity,
      rules: [
        {
          source: "bundled-source",
          match: { tag: "policy", val: "22".repeat(28) },
          from: { tag: "origin" },
          history: "spent-required",
        },
      ],
    },
  };
  const config: KupoConfig = {
    network: identity,
    additionalPackages: {},
    registrations: [bundled],
  };

  const save = async () => {
    const filename = join(root, "configuration/kupo.json");

    await writeFile(`${filename}.tmp`, JSON.stringify(config), { flush: true });
    await rename(`${filename}.tmp`, filename);
  };

  return { network, config, bundled, save };
}

async function additionalPlugin(root: string, config: KupoConfig, cleanup: Cleanup) {
  const registry = await registryFixture({
    listenHost: "0.0.0.0",
    hostname: "host.docker.internal",
  });

  cleanup.defer(registry.remove);

  let stopped = false;

  cleanup.defer(async () => {
    if (!stopped) await registry.close();
  });
  await registry.publish({
    name: "@fixture/custom",
    source: `console.error('custom discovery package loaded'); ${adapterSource("@fixture/custom")}`,
  });
  config.additionalPackages = { "@fixture/custom": "1.0.0" };
  config.registrations.push({ id: "custom", package: "@fixture/custom", deployment: {} });
  await writeFile(join(root, "stack.env"), `CTVS_KUPO_REGISTRY=${registry.url}\n`, { flag: "a" });

  return async () => {
    await registry.close();
    stopped = true;
  };
}

export async function composeFixture(cleanup: Cleanup) {
  const root = await mkdtemp(join(tmpdir(), "ctvs-kupo-compose-"));

  cleanup.defer(() => rm(root, { recursive: true, force: true }));

  const project = `ctvs-kupo-${randomUUID()}`;
  const { network, config, bundled, save } = await configuration(root);
  const data = join(root, "data");
  const cache = join(root, "cache");

  await mkdir(data);
  await mkdir(cache);
  await mkdir(join(root, "configuration"));
  await writeFile(join(root, "indexer.json"), "{}");
  await writeFile(
    join(root, "acceptance.json"),
    JSON.stringify({
      services: {
        kupo: {
          extra_hosts: ["host.docker.internal:host-gateway"],
        },
      },
    }),
  );
  await writeFile(
    join(root, "stack.env"),
    Object.entries({
      CTVS_STACK_NAME: project,
      CTVS_KUPO_IMAGE: startupImage,
      NODE_CONFIG_DIR: network,
      NODE_SOCKET_DIR: root,
      INDEXER_CONFIG: join(root, "indexer.json"),
      KUPO_CONFIG_DIR: join(root, "configuration"),
      G0_POOL_KEYS: join(root, "genesis/pools-keys/pool1"),
      KUPO_PORT: "0",
      OGMIOS_PORT: "0",
      INDEXER_PORT: "0",
    })
      .map(([key, value]) => `${key}=${value}\n`)
      .join(""),
  );

  const compose = (...args: string[]) =>
    docker([
      "compose",
      "--env-file",
      join(root, "stack.env"),
      "-f",
      composePath,
      "-f",
      join(root, "compose.override.yml"),
      "-f",
      join(root, "acceptance.json"),
      ...args,
    ]);

  cleanup.defer(() => compose("down", "--volumes", "--remove-orphans"));

  const name = `${project}-kupo-1`;

  const logs = () => compose("logs", "--no-color", "kupo");

  const state = async () =>
    JSON.parse(await docker(["inspect", "--format", "{{json .State}}", name])) as {
      Running: boolean;
      ExitCode: number;
      Pid: number;
      OOMKilled: boolean;
    };

  async function ready() {
    await eventually(async () => {
      const current = await state();

      if (!current.Running) throw new Error(`Kupo exited (${current.ExitCode}): ${await logs()}`);

      const port = await compose("port", "kupo", "1442");
      const response = await fetch(`http://${port}/health`).catch(() => null);

      await response?.arrayBuffer();

      return response?.ok ? true : undefined;
    }, "container Kupo connected health");
  }

  await save();

  return {
    root,
    data,
    cache,
    config,
    bundled,
    name,
    compose,
    save,
    ready,
    logs,
    state,
    additionalPlugin: () => additionalPlugin(root, config, cleanup),
    inspectStorage: async () => {
      await docker(["cp", `${name}:/kupo-db/.`, data]);
      await docker(["cp", `${name}:/plugin-cache/.`, cache]);
    },
    unownedStorage: async () => {
      const file = join(root, "unowned");

      await writeFile(file, "preserve me");
      await compose("create", "--no-build", "kupo");
      await docker(["cp", file, `${name}:/kupo-db/unowned`]);
    },
    fund: () => fund(root, `${project}-node-1`),
  };
}
