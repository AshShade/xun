import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      include: ["src/lib.ts"],
      thresholds: { statements: 95, branches: 85, functions: 100, lines: 95 },
    },
  },
});
