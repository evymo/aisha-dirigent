import { defineConfig } from "vitest/config";

// Integration config — *.it.test.ts ONLY, run by scripts/test/run-av-integration.mjs against
// REAL clamd + MinIO (docker-compose.av-it.yml). Longer timeouts: real network + clamd's
// first-scan latency. Outside the harness these specs self-skip (describe.skipIf AV_IT!=1).
export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./vitest.it.setup.ts"],
    include: ["src/**/*.it.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
    testTimeout: 90_000,
    hookTimeout: 60_000,
  },
});
