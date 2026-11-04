/** Finish preparation, then replace this process with Kupo so signals and exit status stay native. */
import { accessSync, constants } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import manifest from "../package.json" with { type: "json" };
import { prepareKupo } from "./startup.js";

export function startupDiagnostic(error: unknown): string {
  const messages: string[] = [];
  const seen = new Set<Error>();

  while (error instanceof Error && !seen.has(error)) {
    seen.add(error);
    messages.push(error.message);
    error = error.cause;
  }

  return messages.join("\nCaused by: ") || "Kupo startup failed";
}

export async function main(): Promise<never> {
  if (!process.execve || ["win32", "os400"].includes(process.platform))
    throw new Error("Kupo startup requires Node.js with POSIX process.execve");

  if (process.argv.length > 2)
    throw new Error("Kupo startup does not accept command-line arguments");

  const executable = process.env.CTVS_KUPO_BINARY;

  if (!executable) throw new Error("CTVS_KUPO_BINARY must identify the Kupo executable");

  const binary = resolve(executable);

  accessSync(binary, constants.X_OK);

  const controller = new AbortController();

  const interrupt = () => {
    process.exitCode = 130;
    controller.abort(new Error("Kupo startup interrupted by SIGINT"));
  };

  const terminate = () => {
    process.exitCode = 143;
    controller.abort(new Error("Kupo startup interrupted by SIGTERM"));
  };

  process.once("SIGINT", interrupt);
  process.once("SIGTERM", terminate);

  try {
    const args = await prepareKupo({
      configPath: process.env.CTVS_KUPO_CONFIG ?? "/configuration/kupo.json",
      nodeConfigPath: process.env.CTVS_KUPO_NODE_CONFIG ?? "/network/config.json",
      nodeSocketPath: process.env.CTVS_KUPO_NODE_SOCKET ?? "/ipc/node.socket",
      dataDirectory: process.env.CTVS_KUPO_DATA ?? "/kupo-db",
      cacheDirectory: process.env.CTVS_KUPO_PACKAGE_CACHE ?? "/plugin-cache",
      ...(process.env.CTVS_KUPO_REGISTRY ? { registry: process.env.CTVS_KUPO_REGISTRY } : {}),
      bundled: {
        "@ctvs/example-plugin": {
          version: manifest.dependencies["@ctvs/example-plugin"],
          load: () => import("@ctvs/example-plugin"),
        },
      },
      signal: controller.signal,
    });

    controller.signal.throwIfAborted();

    return process.execve(binary, [binary, ...args], process.env);
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", terminate);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    await new Promise<void>((resolve) => {
      process.stderr.write(`${startupDiagnostic(error)}\n`, () => resolve());
    });
    process.exit(process.exitCode ?? 1);
  }
}
