import { defineConfig } from "@playwright/test";
import path from "path";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  retries: process.env["CI"] ? 2 : 1,
  use: {
    headless: false, // extensions require headed mode
  },
  projects: [
    {
      name: "chromium",
      use: {
        launchOptions: {
          args: [
            `--load-extension=${path.resolve("dist")}`,
            "--no-first-run",
            "--no-default-browser-check",
          ],
        },
      },
    },
  ],
});
