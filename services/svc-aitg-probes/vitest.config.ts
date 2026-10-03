import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      AI_CHAT_SERVICE_URL: 'http://test-ai-chat-service.invalid:3011',
      POSTGREST_URL: 'http://test-postgrest.invalid:3000',
    },
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}", "src/tests/**/*.unit.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
    testTimeout: 15_000,
  },
});
