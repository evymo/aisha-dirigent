import globals from "globals";
import tseslint from "typescript-eslint";

// Minimal, focused ESLint config used as a CI guardrail.
// Purpose: prevent reintroduction of direct console.* usage in production code.

/**
 * Stub plugin that defines no-op rules matching the eslint-disable directives
 * found across the codebase. Without these, the minimal console config reports
 * "Definition for rule X was not found" errors for every disable comment that
 * references a plugin we intentionally don't load here.
 */
const noopRule = { create: () => ({}) };

const reactHooksStub = {
  rules: { "exhaustive-deps": noopRule },
};

const reactRefreshStub = {
  rules: { "only-export-components": noopRule },
};

export default tseslint.config(
  {
    ignores: [
      "dist",
      "**/dist/**",
      "**/build/**",
      "node_modules",
      "coverage/**",
      ".claude/**",
      "archive/**",
      "openxpki-config/**",
      "playwright-report/**",
      "test-results/**",
      "trash/**",
      "workbench/**",
    ],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    linterOptions: {
      // Stub rules intentionally don't fire, so eslint-disable directives for them
      // would be reported as "unused". Suppress those to avoid noise.
      reportUnusedDisableDirectives: "off",
    },
    plugins: {
      "react-hooks": reactHooksStub,
      "react-refresh": reactRefreshStub,
      // @typescript-eslint rules are registered via tseslint.config() below,
      // but we explicitly add no-explicit-any as a no-op since the tseslint
      // recommended preset isn't loaded in this minimal config.
      "@typescript-eslint": {
        rules: {
          "no-explicit-any": noopRule,
          "no-require-imports": noopRule,
        },
      },
    },
    languageOptions: {
      // Use the TypeScript parser so ESLint can parse TS/TSX.
      // We intentionally avoid type-aware linting here; this config is only a guardrail.
      parser: tseslint.parser,
      ecmaVersion: 2020,
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: globals.browser,
    },
    rules: {
      "no-console": "error",
    },
  },
  {
    files: ["src/lib/security/safeLogger.ts"],
    rules: {
      "no-console": ["error", { allow: ["error", "warn", "info"] }],
    },
  },
  {
    files: ["src/tests/**/*.{ts,tsx}"],
    rules: {
      "no-console": "off",
    },
  },
);
