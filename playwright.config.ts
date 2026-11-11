import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// End-to-end against a real engine: chatbot-engine checked out at ENGINE_DIR, served with the
// model-free hashing embedder (fast, deterministic; matches by character n-grams, not meaning).
const ENGINE_DIR = process.env.ENGINE_DIR ?? "engine";
const ENGINE_PORT = 8765;
const APP_PORT = 5179;
const ARTIFACTS = resolve(".e2e/artifacts"); // here, not in the engine checkout

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  retries: 0, // a retry would run against an engine the first attempt already changed
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://127.0.0.1:${APP_PORT}`, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // a fresh in-memory repository and a scratch artifacts directory on every run
      command: `uv run --locked --directory ${ENGINE_DIR} python -m chatcore.api --bot bots/sample --embedder hashing --min-f1 0 --skill-allow-private `
        + `--artifacts ${ARTIFACTS} --port ${ENGINE_PORT}`,
      url: `http://127.0.0.1:${ENGINE_PORT}/healthz`,
      timeout: 180_000,
      reuseExistingServer: false,
      stdout: "pipe", // the engine's log ends up in the CI output
      env: { CHATCORE_DATABASE_URL: "" },
    },
    {
      command: `npx vite --host 127.0.0.1 --port ${APP_PORT} --strictPort`,
      url: `http://127.0.0.1:${APP_PORT}`,
      timeout: 60_000,
      reuseExistingServer: false,
      env: { CHATCORE_ENGINE_URL: `http://127.0.0.1:${ENGINE_PORT}` },
    },
  ],
});
