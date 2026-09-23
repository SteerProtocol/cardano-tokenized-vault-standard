/**
 * Separate fast unit/property checks from signed local integration scenarios.
 * Coverage measures production TypeScript, including files no test imports.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    reporters: ["default", "junit", "json"],
    outputFile: {
      junit: "artifacts/test-results/junit.xml",
      json: "artifacts/test-results/results.json",
    },
    coverage: {
      provider: "v8",
      // Explicit inclusion keeps unimported production files in the coverage denominator.
      include: ["packages/*/src/**/*.ts", "implementations/*/client/src/**/*.ts"],
      exclude: ["**/*.d.ts"],
      reporter: ["text", "html", "lcov", "json-summary"],
      reportsDirectory: "artifacts/coverage",
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 85 },
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: [
            "packages/**/*.test.ts",
            "implementations/*/client/**/*.test.ts",
            "testing/ledger/**/*.test.ts",
            "tools/**/*.test.ts",
          ],
          exclude: ["**/*.property.test.ts", "**/node_modules/**"],
        },
      },
      {
        extends: true,
        test: {
          name: "property",
          setupFiles: ["testing/setup/property.ts"],
          include: [
            "packages/**/*.property.test.ts",
            "implementations/*/client/**/*.property.test.ts",
          ],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["testing/integration/**/*.test.ts"],
          testTimeout: 120_000,
          hookTimeout: 120_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
