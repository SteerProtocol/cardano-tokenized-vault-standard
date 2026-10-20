/** Own all scenario resources from partial setup through final evidence capture and stack shutdown. */
import { type Cleanup, withCleanup } from "../../support/cleanup.js";
import { capture as captureChain } from "./capture.js";
import { environment, finish, nodeStack } from "./environment.js";
import { type ForkNode, stopCopies } from "./fork.js";
import { prepare } from "./prepare.js";

interface NodeOptions {
  family?: "ctvs1" | "ctvs2";
  directory?: string | undefined;
  fork?: boolean;
  forkSecurityParam?: number;
}

export interface NodeFixture {
  env: ReturnType<typeof environment>;
  copies: ForkNode[];
  cleanup: Cleanup;
  capture(label?: string): ReturnType<typeof captureChain>;
}

export function withNode<T>(options: NodeOptions, run: (fixture: NodeFixture) => Promise<T>) {
  return withCleanup(async (cleanup) => {
    const directory = options.directory ?? (await prepare(options));
    const stack = nodeStack(directory);
    let env: ReturnType<typeof environment> | undefined;

    cleanup.defer(() => (env ? finish(env) : stack.compose("down")));
    env = environment(directory, options.family);

    const selected = env;
    const copies: ForkNode[] = [];

    cleanup.defer(() => stopCopies(selected, copies));

    const capture = async (label?: string) => {
      const chain = await captureChain(selected.config, selected.directory, label);

      cleanup.defer(() => chain.close());

      return chain;
    };

    return run({ env: selected, copies, cleanup, capture });
  });
}
