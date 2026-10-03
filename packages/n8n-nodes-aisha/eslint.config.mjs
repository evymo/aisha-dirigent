// Package-local ESLint flat config for the n8n nodes.
//
// Why this exists: the `lint` script (`eslint nodes/ credentials/ --ext .ts`)
// runs from THIS package dir. Without a local flat config it linted with a base
// ruleset that does NOT register `@typescript-eslint/*`, so the intentional
// `// eslint-disable-next-line @typescript-eslint/no-require-imports` directives
// on the lazy optional-dep require() calls (AishaLlmRouter) read as "unused
// disable directive" — 6 spurious warnings — while the ROOT config (which DOES
// enable the rule as an error) needs those very directives. This aligns the two:
// the rule is active here too, so the directives are load-bearing (0 errors) and
// no longer flagged unused. Scoped to no-require-imports to avoid surfacing
// unrelated pre-existing findings in one step.
//
// IMPORTS: use the package's OWN @typescript-eslint/parser + eslint-plugin
// devDependencies — NOT the `typescript-eslint` meta-package, which is only a
// ROOT devDependency. CI runs `npm ci` scoped to this package (no root
// node_modules), so a meta-package import resolves locally (root hoist) but
// ERR_MODULE_NOT_FOUNDs in CI.
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

export default [
  { ignores: ["dist/**", "node_modules/**"] },
  {
    files: ["nodes/**/*.ts", "credentials/**/*.ts"],
    languageOptions: {
      parser: tsParser,
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
    rules: {
      "@typescript-eslint/no-require-imports": "error",
    },
  },
];
