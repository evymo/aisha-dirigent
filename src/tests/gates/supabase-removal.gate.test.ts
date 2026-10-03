/**
 * Supabase Removal Gate
 *
 * Ensures the codebase does NOT import `@supabase/supabase-js` or similar
 * Supabase SDK packages outside explicitly allowed paths. v2 architecture
 * replaces supabase-js with:
 *   - `src/integrations/api/client.ts` (pure HTTP API client → Fastify gateway)
 *   - `src/integrations/db/*` (generated types from the DB schema)
 *
 * If this gate fails, run `node scripts/migrate-supabase-imports.mjs` to
 * bulk-rewrite obvious patterns, then fix residual cases manually.
 *
 * @module
 */
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const PROJECT_ROOT = process.cwd();

/** Directories scanned for supabase-js imports. */
const SCAN_ROOTS = ["src", "scripts", "extensions", "plugins", "mobile-app", "services"];

/** Paths (relative to PROJECT_ROOT) explicitly allowed to reference supabase-js. */
const ALLOWLIST = new Set<string>([
  // Gate tests themselves must contain the banned string as a literal.
  "src/tests/gates/supabase-removal.gate.test.ts",
  "src/tests/gates/service-security.gate.test.ts",
  // Bulk migration script contains the banned string in regex literals.
  "scripts/migrate-supabase-imports.mjs",
]);

/** Directory prefixes to skip entirely. */
const SKIP_PREFIXES = [
  "node_modules/",
  "dist/",
  "build/",
  ".next/",
  "archive/",
  "playwright-report/",
  "test-results/",
  "coverage/",
  ".turbo/",
  "supabase/functions/", // legacy Deno edge fns — kept for reference, deployed via v2 services
];

/** Banned package specifiers (exact match inside `from "..."` or `require("...")`). */
const BANNED_PACKAGES = [
  "@supabase/supabase-js",
  "@supabase/auth-helpers-react",
  "@supabase/auth-helpers-nextjs",
  "@supabase/ssr",
  "@supabase/realtime-js",
];

const FILE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const rel = relative(PROJECT_ROOT, full);
    if (SKIP_PREFIXES.some((p) => rel.startsWith(p) || rel.includes(`/${p}`))) continue;
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      out.push(...walk(full));
    } else if (FILE_EXT.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function collectFiles(): string[] {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) {
    files.push(...walk(join(PROJECT_ROOT, root)));
  }
  return files;
}

interface Violation {
  file: string;
  line: number;
  snippet: string;
  pkg: string;
}

function scanFile(file: string): Violation[] {
  const rel = relative(PROJECT_ROOT, file);
  if (ALLOWLIST.has(rel)) return [];
  const src = readFileSync(file, "utf8");
  const violations: Violation[] = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip pure comment lines — common in migration notes.
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
    for (const pkg of BANNED_PACKAGES) {
      const importRe = new RegExp(
        `(?:from|require\\()\\s*["'\`]${pkg.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}["'\`]`,
      );
      if (importRe.test(line)) {
        violations.push({ file: rel, line: i + 1, snippet: trimmed, pkg });
      }
    }
  }
  return violations;
}

describe("Supabase Removal Gate", () => {
  test("no @supabase/* runtime imports outside allowlist", () => {
    const files = collectFiles();
    const all: Violation[] = [];
    for (const f of files) all.push(...scanFile(f));

    if (all.length > 0) {
      const msg = all
        .map((v) => `  ${v.file}:${v.line} → ${v.pkg}\n    ${v.snippet}`)
        .join("\n");
      throw new Error(
        `Found ${all.length} forbidden Supabase SDK import(s):\n${msg}\n\n` +
          `Fix: replace with '@/integrations/api/client' (HTTP gateway).\n` +
          `Bulk script: node scripts/migrate-supabase-imports.mjs`,
      );
    }
    expect(all).toEqual([]);
  });

  test("package.json has no @supabase/* runtime dependencies", () => {
    const pkg = JSON.parse(readFileSync(join(PROJECT_ROOT, "package.json"), "utf8"));
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    const banned = Object.keys(deps).filter((d) => d.startsWith("@supabase/"));
    if (banned.length > 0) {
      throw new Error(
        `package.json contains banned deps: ${banned.join(", ")}\n` +
          `Remove with: npm uninstall ${banned.join(" ")}`,
      );
    }
    expect(banned).toEqual([]);
  });

  test("no dead Supabase-era local ports (:54321 / :8000) in e2e specs — use the gateway (:3001)", () => {
    // The local stack is gateway=3001, db=54322. The Supabase-era ports 54321
    // (PostgREST) and 8000 (Kong) no longer exist; a spec defaulting to them
    // silently targets a dead port. Canonical fallback: VITE_AISHA_POSTGREST_URL
    // || 'http://127.0.0.1:3001'. (2026-06-10 sweep — completes the partial
    // ee769557 purge.)
    const DEAD = /127\.0\.0\.1:(54321|8000)\b/;
    const e2eDir = join(PROJECT_ROOT, "e2e");
    const violations: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!/\.(ts|tsx|mjs)$/.test(name)) continue;
        const content = readFileSync(p, "utf8");
        content.split("\n").forEach((line, i) => {
          if (DEAD.test(line)) violations.push(`${relative(PROJECT_ROOT, p)}:${i + 1} — ${line.trim().slice(0, 120)}`);
        });
      }
    };
    walk(e2eDir);
    expect(
      violations,
      "Dead Supabase-era ports in e2e specs (use http://127.0.0.1:3001):\n" + violations.join("\n"),
    ).toEqual([]);
  });
});
