import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config";

// Integration tests share one database schema, so files run one at a time.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      dir: "tests/integration",
      setupFiles: ["tests/integration/setup.ts"],
      fileParallelism: false,
      testTimeout: 30_000,
    },
  }),
);
