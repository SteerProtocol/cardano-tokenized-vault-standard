/**
 * The shared seed makes generated cases replayable; each property chooses its own run count.
 * A failing property reports its seed/path for a focused replay.
 */
import fc from "fast-check";

fc.configureGlobal({ seed: 20260916 });
