import path from "node:path";
import { defineConfig, mergeConfig } from "vitest/config";
import rootConfig from "../../vitest.config";

export default mergeConfig(
  rootConfig,
  defineConfig({
    test: {
      setupFiles: [path.resolve(__dirname, "vitest.setup.ts")],
    },
  }),
);
