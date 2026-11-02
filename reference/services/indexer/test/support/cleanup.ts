/** Test-owned resources close in reverse acquisition order; one failure never skips later cleanup. */
export class Cleanup {
  readonly #actions: (() => unknown | Promise<unknown>)[] = [];

  defer(action: () => unknown | Promise<unknown>): void {
    this.#actions.push(action);
  }

  async close(): Promise<void> {
    const failures: unknown[] = [];

    for (const action of this.#actions.splice(0).reverse()) {
      try {
        await action();
      } catch (error) {
        failures.push(error);
      }
    }

    if (failures.length) throw new AggregateError(failures, "Test resource cleanup failed");
  }
}

/** Preserve the scenario failure alongside any shutdown failures, including during partial setup. */
export async function withCleanup<T>(run: (cleanup: Cleanup) => Promise<T>): Promise<T> {
  const cleanup = new Cleanup();
  let result: T;

  try {
    result = await run(cleanup);
  } catch (error) {
    try {
      await cleanup.close();
    } catch (shutdown) {
      throw new AggregateError([error, shutdown], "Test scenario and cleanup failed");
    }

    throw error;
  }

  await cleanup.close();

  return result;
}
