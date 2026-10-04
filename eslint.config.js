import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import security from "eslint-plugin-security";
import noSecrets from "eslint-plugin-no-secrets";
import tseslint from "typescript-eslint";
import { execFileSync } from "node:child_process";

/**
 * Git worktree založený UVNITŘ kořene repa — cizí pracovní plocha, ne náš kód.
 *
 * Ignore vzory níž platí na KOŘENOVÉ úrovni (`trash/**`), takže vnořený checkout
 * si přinese vlastní `trash/`, `archive/` i `dist/` a ty se lintují. Změřeno
 * 2026-07-30: `wt-rls-perf/` (větev jiné session) shodil pre-commit 16 chybami
 * ve svém `trash/legacy-archive/`, přestože v repu se nezměnilo nic.
 *
 * Lint nesmí záviset na tom, co má kdo lokálně rozbalené — na CI ten adresář
 * neexistuje vůbec, takže výsledek by se rozcházel se skutečností. Seznam se
 * ODVOZUJE z gitu, nepíše: jinak by se rozešel s realitou při dalším worktree.
 */
function nestedWorktrees() {
  try {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf-8",
    }).trim();
    return execFileSync("git", ["worktree", "list", "--porcelain"], {
      encoding: "utf-8",
      maxBuffer: 4 * 1024 * 1024,
    })
      .split("\n")
      .filter((l) => l.startsWith("worktree "))
      .map((l) => l.slice("worktree ".length).trim())
      .filter((p) => p !== root && p.startsWith(root + "/"))
      .map((p) => `${p.slice(root.length + 1)}/**`);
  } catch {
    // Bez gitu se nic nevyloučí → lint je PŘÍSNĚJŠÍ, ne mírnější.
    return [];
  }
}

export default tseslint.config(
  {
    ignores: [
      ...nestedWorktrees(),
      "dist",
      "**/dist",
      "coverage/**",
      "offline-knowledge/**",
      "agentsdk-template.ts",
      ".claude/**",
      "archive/**",
      "openxpki-config/**",
      "playwright-report/**",
      "test-results/**",
      "trash/**",
      "workbench/**",
      // Obsah submodulu měří jeho vlastní repo (evymo/aisha-extranet-sdk má
      // vlastní testy a konvence — např. JSX v .js u React Native příkladu).
      "packages/extranet-sdk/**",
      // Local git worktree checkouts (e.g. subagent isolation) — each worktree
      // lints itself; the main tree must not gate on their copies.
      ".worktrees/**",
      "**/.worktrees/**",
      // tests/e2e-dirigent/workspace-fixture/* is INTENTIONALLY broken TS —
      // exists as test material so the dirigent advisor can flag exactly
      // the violations it contains (@ts-ignore, no-explicit-any, etc.).
      // Linting it would report those intentional violations as bugs.
      "tests/e2e-dirigent/workspace-fixture/**",
      // tests/e2e-dirigent/playwright/fixtures/* uses Playwright's fixture
      // pattern (empty destructuring `({}, use) =>`, custom `use` parameter)
      // which ESLint's react-hooks/rules-of-hooks rule + no-empty-pattern
      // false-positive on. Playwright fixtures aren't React hooks.
      "tests/e2e-dirigent/playwright/fixtures/**",
    ],
  },
  {
    // Stale `eslint-disable` directives must FAIL, not linger as warnings —
    // a disabled rule that no longer fires is dead noise that hides real ones.
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      "security": security,
      "no-secrets": noSecrets,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",

      // ── OWASP defense-in-depth via eslint-plugin-security ──
      //
      // Rule severity strategy: rules are tiered by ACTUAL risk surface,
      // not just by lint-rule classification. ReDoS, timing attacks, and
      // path traversal only become real exploits when they process
      // UNTRUSTED input. We harden HTTP entrypoints (services/*/src/routes)
      // separately below; here we surface warnings so real issues
      // don't disappear from view.
      //
      // This is NOT a workaround for the no-workarounds principle:
      //   - "warn" surfaces every potential issue (visible in lint output)
      //   - HTTP routes (highest risk) still error in the per-path block
      //   - Genuine errors like detect-eval, detect-pseudoRandomBytes,
      //     detect-buffer-noassert stay ERROR (these are unambiguous bugs)
      "security/detect-object-injection": "off",          // too noisy; in-repo gate is stricter
      "security/detect-non-literal-fs-filename": "warn",  // file-system traversal — bounded by config
      "security/detect-non-literal-regexp": "warn",       // dynamic regex — usually for code scan
      "security/detect-unsafe-regex": "warn",             // ReDoS — bounded inputs at API edge via Zod
      "security/detect-buffer-noassert": "error",         // unambiguous: data-corruption bug
      "security/detect-child-process": "warn",            // shell injection — usually for build tooling
      "security/detect-eval-with-expression": "error",    // unambiguous: code injection
      "security/detect-no-csrf-before-method-override": "error",
      "security/detect-possible-timing-attacks": "warn",  // const-time compare for secrets only
      "security/detect-pseudoRandomBytes": "error",       // unambiguous: weak crypto
      "security/detect-disable-mustache-escape": "error",

      // ── A02 — secret detection via eslint-plugin-no-secrets ──
      // Catches high-entropy strings (likely API keys / JWT secrets)
      // hardcoded in source.
      "no-secrets/no-secrets": ["error", {
        tolerance: 4.5,           // bits of entropy threshold — default 4
        additionalRegexes: {
          "aws-access-key": "AKIA[0-9A-Z]{16}",
          "github-pat": "ghp_[A-Za-z0-9]{36}",
          "openai-key": "sk-[A-Za-z0-9]{40,}",
          "anthropic-key": "sk-ant-[A-Za-z0-9-]{60,}",
        },
        ignoreContent: [
          "^[A-Fa-f0-9]{40}$",   // SHA-1 git refs in comments
          "^[A-Fa-f0-9]{64}$",   // SHA-256 hashes
        ],
      }],
    },
  },
  // Disable react-refresh for files that legitimately export non-components.
  // These file patterns do not benefit from React Fast Refresh (HMR).
  {
    files: [
      "src/components/ui/**",           // shadcn/ui — exports variant helpers alongside components
      "**/*-columns.{ts,tsx}",           // table column definitions — data-first, not standalone components
      "src/tests/**",                    // test utilities — HMR irrelevant
      "src/hooks/useSecureMode.tsx",     // Context provider + hook (standard React pattern)
      "src/hooks/useSession.tsx",        // Context provider + hook (standard React pattern)
      "src/components/branding/BrandContext.tsx", // createContext + provider (standard React pattern)
      "src/components/common/DocumentRedactor.tsx", // exports REDACTOR_SUPPORTED_TYPES constant
      "src/components/products/ProductDistributionInfo.tsx", // re-export shim
    ],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },

  // Esbuild text-loader templates — bare `@ts-expect-error` is intentional.
  // adapter-claude-overlay.ts imports `.sh` / `.md` / `.mjs.txt` files via
  // esbuild's text loader, which has no TS type declarations available.
  // Each import line uses `@ts-expect-error` to silence the missing-type
  // error. Adding a description to each (per ban-ts-comment rule) would be
  // noise — the pattern is uniform and well-documented in the surrounding
  // comments. Suppress the rule for this one file.
  {
    files: ["extensions/aisha-dirigent/src/generators/adapter-claude-overlay.ts"],
    rules: {
      "@typescript-eslint/ban-ts-comment": "off",
    },
  },

  // HTTP entrypoints — the hot path where untrusted input arrives. Every
  // security/* rule promoted to ERROR here regardless of base severity.
  // ReDoS, timing attacks, and path traversal are exploitable HERE even
  // if the same pattern is benign in build tooling.
  {
    files: [
      "services/*/src/routes/**/*.{ts,tsx}",
      "services/*/src/server.ts",
      "services/svc-aitg-probes/src/lib/probeShape.ts", // shared route helper
    ],
    rules: {
      "security/detect-non-literal-fs-filename": "error",
      "security/detect-non-literal-regexp": "error",
      "security/detect-unsafe-regex": "error",
      "security/detect-child-process": "error",
      "security/detect-possible-timing-attacks": "error",
    },
  },

  // Test + tooling files don't run in the production HTTP-input path.
  // Test fixtures contain intentional fake secrets (JWT-shaped strings,
  // sk- prefixed test keys) to exercise redaction logic. Gates / scripts
  // grep source files (already trusted repo content). E2E + IDE extension
  // code runs in user-controlled contexts where the threat model differs.
  // Turning OFF the runtime-input rules here is NOT a workaround:
  //   - The rules' value is catching cases where untrusted input reaches
  //     a vulnerable sink. These code paths don't have untrusted input.
  //   - Production runtime code paths (services/) are still covered.
  //   - HTTP entrypoints (services/*/src/routes) are still ERROR.
  {
    files: [
      "**/__tests__/**/*.{ts,tsx}",
      "**/*.{test,spec}.{ts,tsx}",
      "src/tests/**/*.{ts,tsx}",
      "src/lib/test-helpers/**/*.{ts,tsx}",     // gate-test heuristics reading repo SQL dirs
      "scripts/**/*.{ts,mjs,js}",
      "services/*/scripts/**/*.{ts,mjs,js}",    // per-service seed/export operator CLIs
      "services/*/src/tests/**/*.{ts,tsx}",     // service unit tests (svc-ai-chat _eval-helper etc.)
      "knowledge-extraction/templates/**",      // gate-test TEMPLATE scanning ROOT-derived dirs
      "mobile-app/app.config.ts",               // Expo build-time config, __dirname-literal paths
      "apps/*/vite.config.ts",                  // shell build-time config — same category as the Expo one above
      "e2e/**/*.{ts,tsx}",
      "extensions/**/*.{ts,tsx}", // IDE / VSCode extension runtime
      "packages/security/src/__tests__/**",
    ],
    rules: {
      "no-secrets/no-secrets": "off",
      "security/detect-non-literal-fs-filename": "off", // tests/scripts read repo paths
      "security/detect-non-literal-regexp": "off",      // dynamically built regexes
      "security/detect-child-process": "off",            // build/test tooling
      "security/detect-unsafe-regex": "off",             // grep over source, not user input
      "security/detect-possible-timing-attacks": "off",  // assertion comparisons
    },
  },

  // ─────────────────────────────────────────────────────────────────────
  // PRECISE per-file rule waivers — each file/rule combo is intentional.
  // NOT blanket ignores: files are still linted for everything else.
  // ─────────────────────────────────────────────────────────────────────

  // E2E test fixture: intentional rule violations that the dirigent
  // advisor's CLI hook tests assert on. Editing the file would shift
  // byte offsets that specs lock to (per file docstring); the violations
  // ARE the test input. Linting them is a category error — they exist
  // BECAUSE they violate the rules, on purpose.
  {
    files: ["tests/e2e-dirigent/workspace-fixture/src/violation.ts"],
    rules: {
      "@typescript-eslint/ban-ts-comment": "off",  // intentional @ts-ignore
      "@typescript-eslint/no-explicit-any": "off", // intentional `: any`
    },
  },

  // Playwright fixture API: `async ({}, use) =>` is Playwright's
  // documented pattern for a fixture that consumes only the `use`
  // parameter. ESLint's `no-empty-pattern` and `react-hooks/rules-of-
  // hooks` (which heuristics on identifiers like `use`) flag false
  // positives — neither rule has Playwright awareness. Waive ONLY in
  // the Playwright fixture directory.
  {
    files: ["tests/e2e-dirigent/playwright/fixtures/**/*.ts"],
    rules: {
      "no-empty-pattern": "off",
      "react-hooks/rules-of-hooks": "off",
    },
  },

  // Registration form compares the user's OWN two password inputs on their own
  // device (`password !== confirmPassword`) — there is no secret to leak and no
  // timing oracle. The heuristic fires on any comparison touching an identifier
  // named `password`; a code change would only obfuscate the intent.
  {
    files: ["mobile-app/src/app/(auth)/register.tsx"],
    rules: {
      "security/detect-possible-timing-attacks": "off",
    },
  },

  // Operator-configured path I/O: claude-cli writes its own workspace dir
  // (config-resolved, service-owned tmp tree); li-driver reads the operator's
  // LinkedIn export bundle from a config-resolved path; demo-fixtures reads the
  // instance fixtures JSON from DEMO_FIXTURES_PATH env (read-only, resolved).
  // The heuristic flags ANY non-literal fs argument regardless of containment —
  // these paths never derive from user/LLM input (env/service config only).
  {
    files: [
      "services/svc-agent-runner/src/backends/claude-cli.ts",
      "services/svc-source-broker/src/clients/li-driver.ts",
    ],
    rules: {
      "security/detect-non-literal-fs-filename": "off",
    },
  },

  // esbuild text-loader template imports: adapter-claude-overlay.ts
  // imports `.sh`, `.md`, `.mjs.txt` files via esbuild's text loader,
  // which has no TypeScript declaration files. Each import uses
  // `@ts-expect-error` to silence the missing-type error. The pattern
  // is uniform across ~9 imports and documented in surrounding
  // comments; adding individual descriptions per `ban-ts-comment`
  // rule would be visual noise that obscures the regularity. Waive
  // ONLY this rule for ONLY this file.
  {
    files: ["extensions/aisha-dirigent/src/generators/adapter-claude-overlay.ts"],
    rules: {
      "@typescript-eslint/ban-ts-comment": "off",
    },
  },
);
