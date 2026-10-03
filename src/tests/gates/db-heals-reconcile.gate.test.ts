/**
 * DB Heals Reconcile Gate
 * =======================
 * Guards the non-destructive incremental-update path the wipe-first baseline
 * model lacks: `aisha/db/heals.sql`, applied by scripts/db/migrate.mjs on EVERY
 * migrate (incl. the no-pending-deltas path — the existing-DB case), BEFORE the
 * entrypoint's db:seed.
 *
 * WHY this gate exists — the failure it locks out:
 *   A schema change folded into the baseline + referenced by the seed
 *   (e.g. claude_hook_bindings.config in fe939cf1) reaches FRESH DBs (baseline
 *   CREATE TABLE) but NOT existing DBs (the baseline is never re-applied — it is
 *   recorded with a NULL checksum so drift detection skips it; only the
 *   destructive AISHA_DB_FORCE_BASELINE_RESET re-runs it, and registry deltas
 *   are blocked by the baseline-only invariant). So prod redeploys failed at
 *   db:seed: `column "config" of relation "claude_hook_bindings" does not exist`.
 *   heals.sql is the bridge. For it to be safe to run on every migrate it MUST
 *   be idempotent, and for it to actually fix the deploy it MUST stay in sync
 *   with the schema the seed needs.
 *
 * This static gate (offline, runs in `npm run test:gates`, i.e. also at pre-push)
 * asserts the heals MECHANISM stays correct. The end-to-end PROOF that an
 * existing pre-fold DB reconciles + seeds clean is the CI upgrade-path gate
 * (scripts/db/verify-upgrade-apply.sh, real Postgres in coldstart-db-gate).
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, test, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();
const HEALS = join(ROOT, "aisha", "db", "heals.sql");
const MIGRATE = join(ROOT, "scripts", "db", "migrate.mjs");

function readSafe(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

const HEALS_DIR = join(ROOT, "aisha", "db");

/**
 * Resolve psql `\ir <relpath>` include directives by inlining the referenced
 * file's content (path is relative to heals.sql's own dir). #445 folded heals'
 * fn defs + role wiring out to `\ir sql/{functions,grants}/<x>.sql` (drift-proof,
 * a single SoT copy). The reconcile-surface scan FOLLOWS the includes and verifies
 * the real reconciled BODY/wiring is present — not merely that an `\ir` line
 * exists (which would false-green on a broken/empty include).
 */
function resolveHealsIncludes(src: string): string {
  return src.replace(/^[ \t]*\\ir[ \t]+(\S+)[ \t]*$/gm, (_m, rel) => {
    const inc = join(HEALS_DIR, rel);
    return existsSync(inc) ? `\n${readFileSync(inc, "utf-8")}\n` : _m;
  });
}

/**
 * Strip SQL noise so keyword scans don't fire inside comments, string literals,
 * or dollar-quoted bodies (function/policy bodies can contain DDL-looking text).
 * Handles both anonymous `$$...$$` and named `$tag$...$tag$` dollar quoting.
 */
function stripSqlNoise(src: string): string {
  return src
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\$([a-zA-Z_]*)\$[\s\S]*?\$\1\$/g, " $DOLLAR$ ")
    .replace(/'(?:''|[^'])*'/g, "''");
}

/** Split stripped SQL into statements on top-level semicolons. */
function statements(strippedSql: string): string[] {
  return strippedSql
    .split(";")
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter(Boolean);
}

describe("DB Heals Reconcile Gate", () => {
  test("aisha/db/heals.sql exists and is non-trivial", () => {
    expect(existsSync(HEALS)).toBe(true);
    expect(readSafe(HEALS).length).toBeGreaterThan(200);
  });

  describe("heals.sql is fully idempotent (safe to run on EVERY migrate)", () => {
    const raw = readSafe(HEALS);
    const stripped = stripSqlNoise(raw);
    const stmts = statements(stripped);

    test("every CREATE TABLE uses IF NOT EXISTS", () => {
      const bad = stmts.filter(
        (s) => /^create\s+table\b/i.test(s) && !/^create\s+table\s+if\s+not\s+exists\b/i.test(s),
      );
      expect(bad, `non-idempotent CREATE TABLE:\n${bad.join("\n")}`).toEqual([]);
    });

    test("every CREATE [UNIQUE] INDEX uses IF NOT EXISTS", () => {
      const bad = stmts.filter(
        (s) =>
          /^create\s+(unique\s+)?index\b/i.test(s) &&
          !/^create\s+(unique\s+)?index\s+(concurrently\s+)?if\s+not\s+exists\b/i.test(s),
      );
      expect(bad, `non-idempotent CREATE INDEX:\n${bad.join("\n")}`).toEqual([]);
    });

    test("every ADD COLUMN uses IF NOT EXISTS", () => {
      const bad = stmts.filter((s) => /\badd\s+column\b/i.test(s) && /\badd\s+column\s+(?!if\s+not\s+exists)/i.test(s));
      expect(bad, `non-idempotent ADD COLUMN:\n${bad.join("\n")}`).toEqual([]);
    });

    test("every ADD CONSTRAINT is guarded by a matching DROP CONSTRAINT IF EXISTS", () => {
      // PG has no `ADD CONSTRAINT IF NOT EXISTS`, so the idempotent pattern is
      // `DROP CONSTRAINT IF EXISTS <name>` immediately followed by `ADD CONSTRAINT
      // <name>` (drop-then-add). A bare ADD re-errors on the 2nd migrate. Require
      // each added constraint name to have a matching drop-guard.
      const added = [...stripped.matchAll(/\badd\s+constraint\s+([a-z0-9_]+)/gi)].map((m) => m[1].toLowerCase());
      const dropGuarded = new Set(
        [...stripped.matchAll(/\bdrop\s+constraint\s+if\s+exists\s+([a-z0-9_]+)/gi)].map((m) => m[1].toLowerCase()),
      );
      const unguarded = added.filter((c) => !dropGuarded.has(c));
      expect(unguarded, `ADD CONSTRAINT without a matching DROP CONSTRAINT IF EXISTS: ${unguarded.join(", ")}`).toEqual([]);
    });

    test("every CREATE FUNCTION is CREATE OR REPLACE", () => {
      const bad = stmts.filter((s) => /^create\s+function\b/i.test(s));
      expect(bad, `non-replaceable CREATE FUNCTION (use OR REPLACE):\n${bad.join("\n")}`).toEqual([]);
    });

    test("every CREATE POLICY is preceded by a DROP POLICY IF EXISTS", () => {
      const creates = (stripped.match(/\bcreate\s+policy\b/gi) || []).length;
      const drops = (stripped.match(/\bdrop\s+policy\s+if\s+exists\b/gi) || []).length;
      expect(drops, `CREATE POLICY (${creates}) not all guarded by DROP POLICY IF EXISTS (${drops})`).toBeGreaterThanOrEqual(creates);
    });

    test("every CREATE TRIGGER is replaceable or drop-guarded", () => {
      const plain = (stripped.match(/\bcreate\s+trigger\b/gi) || []).length;
      const orReplace = (stripped.match(/\bcreate\s+or\s+replace\s+trigger\b/gi) || []).length;
      const dropGuards = (stripped.match(/\bdrop\s+trigger\s+if\s+exists\b/gi) || []).length;
      // plain counts include the OR REPLACE ones (regex \bcreate trigger matches inside
      // "create or replace trigger"? no — "or replace" sits between). Count plain as
      // standalone CREATE TRIGGER not preceded by "or replace".
      const standalone = plain; // \bcreate\s+trigger\b won't match "create or replace trigger"
      expect(standalone, `CREATE TRIGGER (${standalone}) without OR REPLACE (${orReplace}) or DROP TRIGGER IF EXISTS (${dropGuards})`).toBeLessThanOrEqual(orReplace + dropGuards);
    });

    test("no bare CREATE TYPE (must be guarded in a DO block)", () => {
      const bad = stmts.filter((s) => /^create\s+type\b/i.test(s));
      expect(bad, `non-idempotent CREATE TYPE (wrap in guarded DO block):\n${bad.join("\n")}`).toEqual([]);
    });
  });

  describe("heals.sql covers the reconcile surface it is responsible for", () => {
    // Regression guard: heals.sql must keep reconciling the fe939cf1 agent-activity
    // schema that broke prod. If a refactor guts heals.sql, these red BEFORE deploy.
    // `\ir` includes are resolved first so the scan verifies the REAL reconciled
    // body/wiring, whether it sits inline or in an \ir-included SoT file.
    const resolvedHeals = resolveHealsIncludes(readSafe(HEALS));
    const stripped = stripSqlNoise(resolvedHeals).toLowerCase();

    test("reconciles claude_hook_bindings.config (the original deploy-blocker)", () => {
      expect(stripped).toMatch(/alter\s+table\s+(public\.)?claude_hook_bindings\b/);
      expect(stripped).toMatch(/add\s+column\s+if\s+not\s+exists\s+config\b/);
    });

    test("reconciles agent_runs.inputs", () => {
      expect(stripped).toMatch(/alter\s+table\s+(public\.)?agent_runs\b/);
      expect(stripped).toMatch(/add\s+column\s+if\s+not\s+exists\s+inputs\b/);
    });

    test("reconciles the agent-activity / ai-spend tables", () => {
      for (const t of ["agent_phase_catalog", "agent_live_sessions", "ai_cost_class_catalog", "ai_spend_policies"]) {
        expect(stripped, `heals.sql missing CREATE TABLE IF NOT EXISTS for ${t}`).toMatch(
          new RegExp(`create\\s+table\\s+if\\s+not\\s+exists\\s+(public\\.)?${t}\\b`),
        );
      }
    });

    test("reconciles the #422 pre-request JIT-provisioning hook (the 409 fix)", () => {
      // The 409 twin of config: aisha_pre_request + ensure_current_user + the
      // authenticator db_pre_request wiring are baseline-folded → absent on
      // existing DBs → authed callers never provisioned → FK 23503 → 409.
      // `\ir` includes are already resolved into `stripped`/`resolvedHeals`, so we
      // verify the REAL reconciled CREATE OR REPLACE body — not merely that an \ir
      // line exists (which would false-green on a broken/empty include).
      for (const fn of ["ensure_current_user", "aisha_pre_request"]) {
        expect(
          stripped,
          `heals.sql does not reconcile ${fn} — no CREATE OR REPLACE FUNCTION body (inline or \\ir-resolved)`,
        ).toMatch(new RegExp(`create\\s+or\\s+replace\\s+function\\s+(public\\.)?${fn}\\b`));
      }
      // The role wiring's value is a single-quoted literal → stripSqlNoise blanks
      // it, so assert against the RAW resolved text. The ALTER ROLE now arrives via
      // \ir sql/grants/authenticator_pgrst_pre_request.sql (single SoT copy).
      expect(
        resolvedHeals.toLowerCase(),
        "heals.sql missing the authenticator db_pre_request wiring",
      ).toMatch(/alter\s+role\s+authenticator\s+set\s+pgrst\.db_pre_request\s*=\s*'public\.aisha_pre_request'/);
      // CRITICAL — the runtime-reconcile step. The ALTER ROLE only sets a role GUC;
      // a RUNNING PostgREST keeps the OLD db_pre_request until signalled, so on an
      // existing DB the hook stays inert (the 409 persists) until a container
      // restart. heals MUST NOTIFY pgrst to reload config + schema. Lock it in so
      // this — the exact gap #445 reopened and #446 closed — can never silently
      // regress (a fix that only ALTERs the role but never reloads is incomplete).
      const rawHeals = readSafe(HEALS).toLowerCase();
      expect(
        rawHeals,
        "heals.sql must NOTIFY pgrst 'reload config' so a running PostgREST re-reads db_pre_request without a restart",
      ).toMatch(/notify\s+pgrst\s*,\s*'reload config'/);
      expect(
        rawHeals,
        "heals.sql must NOTIFY pgrst 'reload schema' so a running PostgREST re-introspects the JIT-provisioned schema",
      ).toMatch(/notify\s+pgrst\s*,\s*'reload schema'/);
    });

    test("reconciles the #516 polymorphic story_entries columns (the subject_id NOT NULL deploy-blocker)", () => {
      // #516 made story_entries.subject_id NOT NULL + added subject_type/status/moderation_reason
      // to a PRE-EXISTING table. On existing DBs the baseline CREATE TABLE is a no-op so the columns
      // never land → create_story_entry_audited's INSERT (names subject_id) AND the entrypoint reseed
      // both fail the deploy. heals must ADD the columns, backfill from the legacy story_id, then
      // enforce — BEFORE the mirror fn/trigger/RPC that reference subject_id.
      expect(stripped).toMatch(/alter\s+table\s+(public\.)?story_entries\b/);
      for (const col of ["subject_type", "subject_id", "status", "moderation_reason"]) {
        expect(stripped, `heals.sql missing story_entries ADD COLUMN IF NOT EXISTS ${col}`).toMatch(
          new RegExp(`add\\s+column\\s+if\\s+not\\s+exists\\s+${col}\\b`),
        );
      }
      // Backfill the legacy story_id-only rows, then enforce NOT NULL (so the SET NOT NULL succeeds).
      expect(stripped, "heals.sql missing the subject_id backfill from story_id").toMatch(
        /update\s+(public\.)?story_entries\s+set\s+subject_id\s*=\s*story_id/,
      );
      expect(stripped, "heals.sql missing ALTER COLUMN subject_id SET NOT NULL after backfill").toMatch(
        /alter\s+column\s+subject_id\s+set\s+not\s+null/,
      );
    });

    test("reconciles the #516 entry_type_definitions table + discussion RPCs (reseed/runtime deploy-blocker)", () => {
      // entry_type_definitions is a NEW #516 table the CORE seed (36_discussion_entry_types.sql — every
      // profile) inserts into on EVERY deploy → "relation does not exist" reseed failure on existing DBs.
      expect(stripped, "heals.sql missing CREATE TABLE IF NOT EXISTS entry_type_definitions").toMatch(
        /create\s+table\s+if\s+not\s+exists\s+(public\.)?entry_type_definitions\b/,
      );
      for (const fn of ["create_discussion_entry_audited", "get_discussion_entries", "get_entry_types"]) {
        expect(stripped, `heals.sql missing reconcile of ${fn} (discussion primitive inert on existing DBs)`).toMatch(
          new RegExp(`create\\s+or\\s+replace\\s+function\\s+(public\\.)?${fn}\\b`),
        );
      }
    });

    test("reconciles news_articles.tags (#512) + the archive/blog reader RPCs", () => {
      // #512 added news_articles.tags (+ GIN index) + get_news_tags / get_published_news_articles_filtered
      // to drive the dynamic archive/blog tag filter; absent on existing DBs → the news browser block 404s.
      expect(stripped).toMatch(/alter\s+table\s+(public\.)?news_articles\b/);
      expect(stripped, "heals.sql missing news_articles ADD COLUMN IF NOT EXISTS tags").toMatch(
        /add\s+column\s+if\s+not\s+exists\s+tags\b/,
      );
      for (const fn of ["get_news_tags", "get_published_news_articles_filtered"]) {
        expect(stripped, `heals.sql missing reconcile of ${fn}`).toMatch(
          new RegExp(`create\\s+or\\s+replace\\s+function\\s+(public\\.)?${fn}\\b`),
        );
      }
    });
  });

  describe("heals.sql establishment ordering (executable refs follow their objects)", () => {
    // The incident class (PR #577 + follow-up): heals is applied top-to-bottom with
    // ON_ERROR_STOP, and \ir'd FUNCTION bodies are deferred (validated at call time) —
    // but FK "REFERENCES", DML backfills and DO-block SQL execute IMMEDIATELY. A
    // statement that names a table which heals itself only establishes FURTHER DOWN
    // aborts the whole heals run on any DB old enough to lack that table (observed:
    // the Brick2-guard FK referenced ai_model_registry ~230 lines before the
    // registry heal block created it — while its comment claimed the opposite).
    // This scan is RAW-text only (includes are not resolved): included files are
    // function bodies (deferred) or self-guarded object SoT files; the raw heals
    // text is exactly the immediately-executed surface.
    const raw = readSafe(HEALS);
    // strip line comments, keep line structure for indexes
    const stripped = raw
      .split("\n")
      .map((l) => l.replace(/--.*$/, ""))
      .join("\n");

    // tables heals itself establishes, keyed by FIRST establishment offset
    const established = new Map<string, number>();
    for (const m of stripped.matchAll(
      /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.(\w+)/gi,
    )) {
      const t = m[1].toLowerCase();
      if (!established.has(t)) established.set(t, m.index ?? 0);
    }

    test("found the heals-established table set", () => {
      // sanity: the generational reconcile section establishes dozens of tables
      expect(established.size).toBeGreaterThan(20);
    });

    test("no executable statement references a heals-established table before its establishment", () => {
      const refPatterns: Array<[string, RegExp]> = [
        ["REFERENCES", /\bREFERENCES\s+public\.(\w+)/gi],
        ["UPDATE", /\bUPDATE\s+public\.(\w+)/gi],
        ["INSERT INTO", /\bINSERT\s+INTO\s+public\.(\w+)/gi],
        ["DELETE FROM", /\bDELETE\s+FROM\s+public\.(\w+)/gi],
        ["FROM", /\bFROM\s+public\.(\w+)/gi],
        ["JOIN", /\bJOIN\s+public\.(\w+)/gi],
        ["ALTER TABLE", /\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?public\.(\w+)/gi],
        ["INDEX ON", /\bINDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?\w+\s+ON\s+public\.(\w+)/gi],
        ["TRIGGER ON", /\bTRIGGER\s+\w+\s+ON\s+public\.(\w+)/gi],
      ];
      const violations: string[] = [];
      for (const [kind, re] of refPatterns) {
        for (const m of stripped.matchAll(re)) {
          const t = m[1].toLowerCase();
          const at = m.index ?? 0;
          const estAt = established.get(t);
          if (estAt !== undefined && at < estAt) {
            const line = stripped.slice(0, at).split("\n").length;
            const estLine = stripped.slice(0, estAt).split("\n").length;
            violations.push(
              `${kind} public.${t} at heals.sql:${line} precedes its establishment at :${estLine}`,
            );
          }
        }
      }
      expect(
        violations,
        `heals.sql executes references to tables it only establishes later:\n${violations.join("\n")}\n` +
          "Move the referencing block BELOW the establishment block (or hoist the establishment).",
      ).toEqual([]);
    });
  });

  describe("migrate.mjs applies heals UNCONDITIONALLY (both the pending and no-pending paths)", () => {
    const src = readSafe(MIGRATE);

    test("migrate.mjs references aisha/db/heals.sql", () => {
      expect(src).toMatch(/heals\.sql/);
    });

    test("heals run via the migrate connection (DDL rights), not a separate conn", () => {
      // Must reconcile DDL with the migrate role; a seed-role conn lacks ALTER rights.
      expect(src).toMatch(/runPsql\(\s*connStr\s*,[^)]*HEALS_FILE/);
    });

    test("heals applied after BOTH the no-pending and the all-applied branches", () => {
      // The bug class to lock out: heals nested inside the `pendingFiles>0` branch
      // would be INERT on existing DBs (which have no pending deltas) — exactly how
      // #427's baseline heal was inert. Source-order proves it is at the
      // unconditional tail: it appears AFTER both branch markers.
      const noPending = src.indexOf("No pending migrations");
      const allApplied = src.indexOf("All migrations applied");
      const healsRun = src.search(/existsSync\(HEALS_FILE\)/);
      expect(noPending, "expected 'No pending migrations' marker").toBeGreaterThan(-1);
      expect(allApplied, "expected 'All migrations applied' marker").toBeGreaterThan(-1);
      expect(healsRun, "expected heals application block").toBeGreaterThan(-1);
      expect(healsRun).toBeGreaterThan(noPending);
      expect(healsRun).toBeGreaterThan(allApplied);
    });
  });
});
