/**
 * AISHA Branding Gate — strict, baseline-driven
 *
 * Why this exists:
 *   The existing `supabase-removal.gate.test.ts` only scans **JS/TS imports**,
 *   so it failed to catch `supabase` strings in compose YAMLs, shell scripts,
 *   `.env*` files and JSON configs. That gap allowed Supabase branding to leak
 *   into production IaC (DB roles, env vars, JWT iss claim, MinIO buckets…).
 *
 * What this gate does:
 *   1. Walks the repo and counts case-insensitive `supabase` occurrences in
 *      EVERY relevant file type (.yml, .yaml, .sh, .ts, .tsx, .js, .mjs, .cjs,
 *      .json, .env*, .md is intentionally excluded — historical docs allowed).
 *   2. Compares the per-file count against `aisha-branding.baseline.json`.
 *   3. **Fails** if any of:
 *        a) A new file (not in baseline) contains `supabase`.
 *        b) An existing file's count is **higher** than the baseline.
 *      Lower counts are always allowed (debt monotonically shrinks).
 *
 * How to fix a failure:
 *   - Remove the offending `supabase` reference (preferred).
 *   - If genuinely unavoidable (e.g. legacy `.env.backup.*`), regenerate
 *     baseline: `npm run gate:branding:baseline`.
 *
 * The baseline file is committed and code-reviewed — every PR that updates it
 * must justify the change.
 *
 * @module
 */
import { describe, test, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";

const PROJECT_ROOT = process.cwd();
const BASELINE_PATH = join(PROJECT_ROOT, "src/tests/gates/aisha-branding.baseline.json");

/** File extensions scanned. Markdown and binary types are excluded. */
const FILE_EXT = /\.(ya?ml|sh|ts|tsx|js|jsx|mjs|cjs|json)$/;
/** Dotfile-style env files (`.env`, `.env.coolify`, `.env.example`, …). */
const ENV_FILE = /(^|\/)\.env(\.|$)/;

/** Directories never scanned (vendored, generated, archived, runtime artefacts). */
const SKIP_DIR_PARTS = new Set([
  "node_modules",
  ".git",
  ".claude", // git worktrees + local Claude agent state — not production code
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
  "playwright-report",
  "test-results",
  "archive",
  "trash",
  ".aisha", // local audit/cache state
  "supabase", // legacy Supabase-CLI tree (kept until full migration of edge fns)
  "workbench", // vendored VSCodium fork — out of scope
  "offline-knowledge", // generated docs/reports snapshot
  "knowledge-extraction", // vendored
]);

/**
 * Specific files allowed to contain the literal string.
 *
 * RULE: pouze gate trackers + migration tooling. Žádný production kód, žádný
 * "tady to projde aby projít musel". Když přidáváš entry, musíš zdůvodnit
 * že soubor MUSÍ obsahovat string z designu (gate enforcement, migration).
 */
const ALLOWLIST = new Set<string>([
  // Self-reference (gate scans itself, must mention pattern)
  "src/tests/gates/aisha-branding.gate.test.ts",
  "src/tests/gates/aisha-branding.baseline.json",
  // Other gate trackers — záměrně obsahují legacy identifikátory pro
  // monotone-decrease enforcement (deprecation tracking)
  "src/tests/gates/supabase-removal.gate.test.ts",
  // Vynucuje ZÁKAZ typu pověření supabaseApi v uzlech n8n — musí ho jmenovat.
  "src/tests/gates/n8n-uzly-autentizace-pres-povereni.gate.test.ts",
  // Registr dluhu jiné rohatky: jmenuje CESTY skriptů, mezi nimi i
  // `scripts/migrate-supabase-imports.mjs` (ten je výš povolen ze stejného
  // důvodu). Jméno souboru v seznamu dluhu není odkaz na Supabase.
  "src/tests/gates/neznamy-prepinac-neni-vychozi-chovani.baseline.json",
  "src/tests/gates/service-security.gate.test.ts",
  "src/tests/gates/deprecated-stack-refs.gate.test.ts",
  // Zakazuje obrazy `supabase/*` a proměnné `GOTRUE_*` v compose — to jméno
  // musí napsat, aby ho mohl hlídat (2026-08-13, nahradil test na
  // GOTRUE_EXTERNAL_KEYCLOAK_PKCE, který neměl v žádném compose co měřit).
  "src/tests/gates/coolify-compose-compliance.gate.test.ts",
  // Remediation detection gates — must mention the legacy 'supabaseUrl' credential
  // key precisely to FORBID it (they enforce the postgrestUrl migration).
  "src/tests/gates/remediation/n8n-credential-postgresturl.gate.test.ts",
  "src/tests/gates/remediation/workbench-execution-rail-wired.gate.test.ts",
  "src/tests/gates/zed-bridge-bundle-fresh.gate.test.ts",
  // Vynucuje PŘIPNUTOU verzi CLI generátoru typů (`supabase@X.Y.Z`, zákaz `@latest`
  // a `npx supabase gen` bez verze) — jméno balíčku musí napsat v regexu i ve
  // kontrolních vzorcích, jinak by neměl co hlídat (2026-09-29).
  "src/tests/gates/typegen-cli-pripnuty.gate.test.ts",
  // Migration tooling — operuje s legacy strings dle designu
  "scripts/migrate-supabase-imports.mjs",
  "scripts/gen-aisha-branding-baseline.mjs",
]);

/**
 * Files/patterns treated as runtime artefacts (generated, gitignored, never committed).
 * Any match is fully skipped by the gate — scanner cannot baseline volatile content.
 */
const RUNTIME_ARTEFACTS = [
  /^\.env\.coolify$/,        // aisha-cold-start.sh generates each run from .env-prod-backup
  /^\.env\.coolify\.bak$/,   // env-doctor pre-write backup (transient, gitignored via *.bak)
  /^\.env\.bak$/,            // ad-hoc env backup (transient, gitignored via *.bak)
  /^\.env-prod-backup$/,     // operator secret vault (never in repo)
  /^\.env\.backup(\..+)?$/,  // local dev backups
  /^\.env\.local$/,          // dev-only
  /^docs\/db-structure\/gates-test-report\.json$/, // generated by gates run; contains test names like "Supabase Removal Gate"
];

const PATTERN = /supabase/gi;

function shouldSkip(rel: string): boolean {
  const parts = rel.split("/");
  if (parts.some((p) => SKIP_DIR_PARTS.has(p))) return true;
  if (RUNTIME_ARTEFACTS.some((rx) => rx.test(rel))) return true;
  return false;
}

function isScannable(rel: string): boolean {
  return FILE_EXT.test(rel) || ENV_FILE.test(rel);
}

/**
 * Source-of-truth for "what files belong to the repo": `git ls-files`.
 *
 * Earlier this gate walked the filesystem (`readdirSync` recursion) which
 * picked up local-only files like operator's `.env`, `.env.aisha`,
 * `.env.coolify.backup-*` (date-suffixed) — all gitignored but still on
 * disk on developer workstations. Those false positives blocked pre-push
 * for every workstation with a runtime artefact left over.
 *
 * `git ls-files -z` returns NUL-separated tracked paths only, so
 * .gitignore is honored implicitly. Local-only dev files never reach the
 * scanner. The RUNTIME_ARTEFACTS regex list becomes mostly redundant but
 * we keep it as belt-and-suspenders for files that ARE tracked yet
 * volatile (none currently, but the slot is reserved for future use).
 */
function listScannableFiles(): string[] {
  const stdout = execFileSync("git", ["ls-files", "-z"], {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout
    .split("\0")
    .filter((p) => p.length > 0)
    .filter((rel) => !shouldSkip(rel))
    .filter((rel) => isScannable(rel));
}

function countOccurrences(file: string): number {
  try {
    const src = readFileSync(join(PROJECT_ROOT, file), "utf8");
    const m = src.match(PATTERN);
    return m ? m.length : 0;
  } catch {
    return 0;
  }
}

interface Baseline {
  generated_at: string;
  total_files: number;
  total_occurrences: number;
  files: Record<string, number>;
}

function loadBaseline(): Baseline {
  if (!existsSync(BASELINE_PATH)) {
    return { generated_at: "", total_files: 0, total_occurrences: 0, files: {} };
  }
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline;
}

describe("AISHA Branding Gate", () => {
  test("no new 'supabase' references introduced; existing files only shrink", () => {
    const baseline = loadBaseline();
    const files = listScannableFiles();

    const newOffenders: string[] = [];
    const grew: string[] = [];

    for (const file of files) {
      if (ALLOWLIST.has(file)) continue;
      const count = countOccurrences(file);
      if (count === 0) continue;
      const baselineCount = baseline.files[file] ?? 0;
      if (baselineCount === 0) {
        newOffenders.push(`${file} (${count} occurrence(s))`);
      } else if (count > baselineCount) {
        grew.push(`${file} (${count} > baseline ${baselineCount})`);
      }
    }

    if (newOffenders.length > 0 || grew.length > 0) {
      const lines: string[] = [];
      if (newOffenders.length > 0) {
        lines.push(`NEW files containing 'supabase' (${newOffenders.length}):`);
        for (const n of newOffenders) lines.push(`  + ${n}`);
      }
      if (grew.length > 0) {
        lines.push(`Files whose count GREW above baseline (${grew.length}):`);
        for (const g of grew) lines.push(`  ↑ ${g}`);
      }
      lines.push("");
      lines.push("Fix the file (preferred), or — if intentional — regenerate baseline:");
      lines.push("  node scripts/gen-aisha-branding-baseline.mjs");
      throw new Error(lines.join("\n"));
    }
    expect({ newOffenders, grew }).toEqual({ newOffenders: [], grew: [] });
  });

  test("baseline file exists and is structurally valid", () => {
    expect(existsSync(BASELINE_PATH), "baseline file is missing").toBe(true);
    const b = loadBaseline();
    expect(typeof b.total_occurrences, "baseline.total_occurrences must be number").toBe("number");
    expect(typeof b.files, "baseline.files must be object").toBe("object");
  });
});
