import { defineConfig, type Plugin } from "vitest/config";
import fs from "fs";
import path from "path";

/**
 * Vite plugin: treat .sh and .md imports as raw text (mirror of the
 * esbuild text loader in esbuild.config.js). Needed so the
 * adapter-claude-overlay TS port can bundle templates at test time.
 */
function rawTextLoader(): Plugin {
  return {
    name: "raw-text-sh-md",
    enforce: "pre",
    // `load` runs BEFORE Vite's default file loaders (which would otherwise
    // try to parse .mjs as a JS module and fail on the relay's top-level await).
    // The `transform` hook would arrive too late for that.
    load(id) {
      const stripped = id.split("?")[0];
      // Mirror esbuild.config.js loader entries: .sh + .md + .mjs as text.
      // .mjs is needed for the Vrstva 2 relay template (extracted to disk,
      // not executed inside the extension).
      if (
        stripped.endsWith(".sh") ||
        stripped.endsWith(".md") ||
        stripped.endsWith(".txt")
      ) {
        const content = fs.readFileSync(stripped, "utf-8");
        return `export default ${JSON.stringify(content)};`;
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [rawTextLoader()],
  test: {
    root: path.resolve(__dirname),
    environment: "node",
    globals: true,
    include: ["__tests__/**/*.test.ts"],
    testTimeout: 10000,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: ["**/*.test.ts", "__tests__/**"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
  resolve: {
    alias: {
      vscode: path.resolve(__dirname, "__tests__/__mocks__/vscode.ts"),
    },
  },
});
