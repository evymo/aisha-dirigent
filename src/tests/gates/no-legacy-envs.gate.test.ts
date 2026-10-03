/**
 * No Legacy Envs Gate
 *
 * Prevents regression to deprecated supabase / kong terminology in the
 * AISHA self-hosted stack. The codebase MUST use AISHA_POSTGREST_* (utility
 * client) instead of plain SUPABASE_* (legacy hosted service contract).
 *
 * Allow-listed locations:
 *   - trash/, archive/  (preserved historical artifacts)
 *   - node_modules/, .git/
 *   - extensions/aisha-dirigent/dist/  (compiled output)
 *   - aisha/db/seed.instance.sql, aisha/db/migrations/00000000000000_baseline.sql
 *     (generated SoT — regenerated via npm run db:init:generate; carry historic
 *      docs strings inside seed text)
 *   - *.baseline.json  (gate baselines)
 *   - this gate file itself
 *   - docs/  (historical references — cleaned separately)
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, test, expect } from "vitest";
import { execSync } from "child_process";

const ROOT = process.cwd();

const FORBIDDEN_PATTERNS: Array<{ name: string; pattern: string }> = [
  {
    name: "plain SUPABASE_URL / ANON_KEY / SERVICE_KEY (use AISHA_POSTGREST_*)",
    pattern:
      "(?<![A-Z_])SUPABASE_(URL|ANON_KEY|SERVICE_ROLE_KEY|SERVICE_KEY|JWT_SECRET|PROJECT_REF|PROJECT_ID|ACCESS_TOKEN|CLI_MODE)\\b",
  },
  {
    name: "VITE_SUPABASE_* (use VITE_AISHA_POSTGREST_*)",
    pattern: "(?<![A-Z_])VITE_SUPABASE_",
  },
  {
    name: "EXPO_PUBLIC_SUPABASE_* (use EXPO_PUBLIC_AISHA_POSTGREST_*)",
    pattern: "(?<![A-Z_])EXPO_PUBLIC_SUPABASE_",
  },
  {
    // Phase 3 of the env-var rename — after PR #88 swept the codebase, this
    // gate locks the canonical AISHA_POSTGREST_* names. Any reintroduction
    // (incl. VITE_, EXPO_PUBLIC_, LOCAL_, PROD_ prefixes) fails CI.
    name: "AISHA_SUPABASE_* identifiers (use AISHA_POSTGREST_* — Supabase platform retired 2026-Q1)",
    pattern: "AISHA_SUPABASE_(URL|SERVICE_KEY|ANON_KEY|PUBLISHABLE_KEY)\\b",
  },
  {
    name: "JSON field \"supabase_url\" (renamed to \"aisha_url\")",
    pattern: '"supabase_url"',
  },
  {
    name: "kong references (legacy supabase API gateway, replaced by direct PostgREST + own gateway)",
    pattern: "\\bkong\\b",
  },
];

const EXCLUDE_GLOBS = [
  "trash",
  "archive",
  "node_modules",
  ".git",
  "extensions/aisha-dirigent/dist",
  "playwright-report",
  "test-results",
  "knowledge-extraction",
  "aisha/db/seed.instance.sql",
  "aisha/db/migrations/00000000000000_baseline.sql",
  "src/tests/gates/no-legacy-envs.gate.test.ts",
  // deprecation tracker gate — záměrně obsahuje legacy stack identifikátory
  // (Kong, GoTrue) jako baseline strings pro monotone-decrease enforcement.
  // Vyloučeno z no-legacy-envs scanu (gate tracking != legacy code).
  "src/tests/gates/deprecated-stack-refs.gate.test.ts",
];

/**
 * Vnořené git checkouty (worktree založený UVNITŘ kořene repa).
 *
 * Nejsou to soubory tohohle repa — je to pracovní plocha jiné větve, která
 * náhodou leží v podadresáři. Skenovat je znamená, že verdikt brány závisí na
 * tom, co má kdo lokálně rozbalené: na CI ten adresář neexistuje, u kolegy
 * obsahuje něco jiného, a táž změna dá jiný výsledek. Změřeno 2026-07-30 —
 * `wt-rls-perf/` (větev perf/rls-narok-initplan, založený jinou session) shodil
 * pět testů nálezy ve svých docs, přestože v repu se nezměnilo nic.
 *
 * Seznam se ODVOZUJE z `git worktree list`, nepíše — jinak by se rozešel
 * s realitou při každém dalším worktree.
 */
function nestedCheckouts(): string[] {
  try {
    const out = execSync("git worktree list --porcelain", {
      cwd: ROOT,
      encoding: "utf-8",
      maxBuffer: 4 * 1024 * 1024,
    });
    const root = execSync("git rev-parse --show-toplevel", { cwd: ROOT, encoding: "utf-8" }).trim();
    return out
      .split("\n")
      .filter((l) => l.startsWith("worktree "))
      .map((l) => l.slice("worktree ".length).trim())
      .filter((p) => p !== root && p.startsWith(root + "/"))
      .map((p) => p.slice(root.length + 1))
      // Cesta se lepí do shellového `-g '!…'`, takže apostrof by řetězec rozbil.
      // Takovou cestu radši NEVYLOUČÍM (brána zůstane přísnější) — tiché
      // porušení příkazu by bylo horší než falešný nález.
      .filter((p) => !/['"\\]/.test(p));
  } catch {
    // Bez git informace se nic nevyloučí → brána je PŘÍSNĚJŠÍ, ne mírnější.
    return [];
  }
}

function rgFind(pattern: string): string[] {
  const excludeArgs = [...EXCLUDE_GLOBS, ...nestedCheckouts()]
    .map((g) => `-g '!${g}'`)
    .join(" ");
  // also exclude *.baseline.json files anywhere
  const cmd = `rg -l --hidden -P ${excludeArgs} -g '!*.baseline.json' -g '!docs/**' ${JSON.stringify(pattern)} . 2>/dev/null || true`;
  const out = execSync(cmd, { cwd: ROOT, encoding: "utf-8", maxBuffer: 16 * 1024 * 1024 });
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

describe("No Legacy Envs Gate", () => {
  for (const { name, pattern } of FORBIDDEN_PATTERNS) {
    test(`no occurrences of: ${name}`, () => {
      const matches = rgFind(pattern);
      expect(
        matches,
        `Found legacy pattern "${pattern}" in:\n  - ${matches.join("\n  - ")}\n\n` +
          `These references must use the AISHA_* / aisha_* equivalents or be moved to trash/.`,
      ).toEqual([]);
    });
  }
});
