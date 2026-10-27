/** Minimal CLI/IO imports for the Rust component; no inherited environment or standard streams. */
import { terminalInput, terminalOutput } from "@bytecodealliance/preview2-shim/cli";
import { error, poll, streams } from "@bytecodealliance/preview2-shim/io";

export type BuiltinImport =
  | `wasi:cli/${"environment" | "exit" | "stdin" | "stdout" | "stderr"}`
  | `wasi:cli/terminal-${"input" | "output" | "stdin" | "stdout" | "stderr"}`
  | `wasi:io/${"error" | "poll" | "streams"}`;

function unavailable(): never {
  throw new Error("standard IO is not enabled for this plugin");
}

export function wasiImports(): Record<BuiltinImport, unknown> {
  return {
    "wasi:cli/environment": {
      getEnvironment: () => [],
      getArguments: () => [],
      initialCwd: () => undefined,
    },
    "wasi:cli/exit": {
      exit: () => {
        throw new Error("plugin requested WASI exit");
      },
    },
    "wasi:cli/stdin": { getStdin: unavailable },
    "wasi:cli/stdout": { getStdout: unavailable },
    "wasi:cli/stderr": { getStderr: unavailable },
    "wasi:cli/terminal-input": terminalInput,
    "wasi:cli/terminal-output": terminalOutput,
    "wasi:cli/terminal-stdin": { getTerminalStdin: () => undefined },
    "wasi:cli/terminal-stdout": { getTerminalStdout: () => undefined },
    "wasi:cli/terminal-stderr": { getTerminalStderr: () => undefined },
    "wasi:io/error": error,
    "wasi:io/poll": poll,
    "wasi:io/streams": streams,
  };
}
