/**
 * DB Convergence — schema equivalence gate (the migration-architecture safety net).
 * ============================================================================
 * Proves that two upgrade PATHS land on the SAME schema, so a multi-file SoT and
 * its reconcile/migration set can never silently diverge:
 *
 *   DB-A (fresh install)   = substrate → baseline
 *   DB-B (existing-DB path) = substrate → baseline → (forward migrations) → reconcile
 *
 * Today the "reconcile" surface is heals.sql and there are 0 forward migrations, so
 * A ≡ B is trivially true — but the gate now EXISTS and runs the real reconcile on a
 * clean path, becoming the primary regression detector when later phases swap
 * heals.sql → generated reconcile.sql, fix the DROP TYPE CASCADE, and admit forward
 * migrations. If any of those loses or adds an object, the normalized pg_dump diff
 * reds with a unified diff.
 *
 * DB-REQUIRING: needs a Postgres reachable via AISHA_DB_URL / DATABASE_URL. Skips
 * (does not fail) when absent, so it is inert in the offline `test:gates` run and
 * runs for real under:
 *   node scripts/db/with-throwaway-db.mjs -- npx vitest run src/tests/gates/db-convergence-schema-equivalence.gate.test.ts
 */
import { describe, test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = process.cwd();
const DB_URL = process.env.AISHA_DB_URL || process.env.DATABASE_URL || "";
const SUBSTRATE = join(ROOT, "infra/postgres/000_init_roles_schemas.sql");
const BASELINE = join(ROOT, "aisha/db/migrations/00000000000000_baseline.sql");
const HEALS = join(ROOT, "aisha/db/heals.sql"); // reconcile surface (becomes reconcile.sql in Phase 2)

function pgEnv() {
  // PGPASSWORD travels via the URL, but set it too for tools that ignore the URL pw.
  const m = DB_URL.match(/postgresql:\/\/[^:]+:([^@]+)@/);
  return { ...process.env, ...(m ? { PGPASSWORD: m[1] } : {}) };
}

/** URL pointing at a specific database name in the same cluster. */
function urlFor(dbName: string): string {
  return DB_URL.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`);
}

function psql(url: string, args: string[]) {
  execFileSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-q", ...args], {
    env: pgEnv(),
    stdio: ["ignore", "ignore", "pipe"],
    maxBuffer: 256 * 1024 * 1024,
  });
}

/** Create a fresh DB, apply substrate + baseline (+ optional reconcile), return its pg_dump. */
function buildAndDump(dbName: string, withReconcile: boolean): string {
  const admin = urlFor("postgres");
  // Terminate + drop + recreate for a clean slate.
  execFileSync("psql", [admin, "-v", "ON_ERROR_STOP=1", "-q", "-c",
    `DROP DATABASE IF EXISTS ${dbName} WITH (FORCE);`], { env: pgEnv(), stdio: ["ignore", "ignore", "pipe"] });
  execFileSync("psql", [admin, "-v", "ON_ERROR_STOP=1", "-q", "-c",
    `CREATE DATABASE ${dbName};`], { env: pgEnv(), stdio: ["ignore", "ignore", "pipe"] });

  const url = urlFor(dbName);
  psql(url, ["-f", SUBSTRATE]);
  psql(url, ["-f", BASELINE]);
  if (withReconcile) psql(url, ["-f", HEALS]); // \ir paths resolve relative to heals.sql's dir

  // pg_dump is MAJOR-version-strict (a v14 host pg_dump cannot dump a v17 server),
  // so run the server's OWN pg_dump inside the throwaway container — guarantees a
  // version match on any host/CI. (psql above is forward-compatible, host is fine.)
  const container = process.env.AISHA_TESTDB_CONTAINER || "aisha-testdb-throwaway";
  const pw = (DB_URL.match(/postgresql:\/\/[^:]+:([^@]+)@/) || [])[1] || "postgres";
  const dump = execFileSync(
    "docker",
    ["exec", "-e", `PGPASSWORD=${pw}`, container, "pg_dump",
      "-h", "127.0.0.1", "-U", "postgres", "-d", dbName,
      "--schema-only", "--no-owner", "--no-privileges", "--no-comments"],
    { encoding: "utf-8", maxBuffer: 256 * 1024 * 1024 },
  );
  return dump;
}

/** Strip pg_dump noise so the comparison is SEMANTIC, not textual. */
function normalize(dump: string): string {
  return dump
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      if (t === "") return false;
      if (t.startsWith("--")) return false; // comments / section banners
      if (/^SET\s/.test(t)) return false; // SET statement_timeout, search_path, …
      if (/^SELECT pg_catalog\.set_config/.test(t)) return false;
      // pg17 wraps dumps in \restrict/\unrestrict with a RANDOM per-dump token — pure noise.
      if (/^\\(un)?restrict\b/.test(t)) return false;
      return true;
    })
    .map((l) => l.replace(/\s+/g, " ").trim())
    .sort() // order-independent: dependency order can differ, the SET of statements must not
    .join("\n");
}

const run = DB_URL ? describe : describe.skip;

run("DB Convergence — fresh-baseline ≡ baseline+reconcile (schema equivalence)", () => {
  let dumpA = "";
  let dumpB = "";

  test("build both upgrade paths and dump their schemas", () => {
    dumpA = buildAndDump("conv_a", false); // fresh install
    dumpB = buildAndDump("conv_b", true); // existing-DB path (baseline + reconcile)
    // Non-triviality: the baseline must actually create a real schema.
    const tableCount = (dumpA.match(/^CREATE TABLE /gm) || []).length;
    expect(tableCount, "baseline produced suspiciously few tables — harness misfire").toBeGreaterThan(100);
  }, 600_000);

  test("the two paths converge to an IDENTICAL schema", () => {
    const a = normalize(dumpA);
    const b = normalize(dumpB);
    if (a !== b) {
      // Emit a compact unified-ish diff of the first divergences.
      const sa = new Set(a.split("\n"));
      const sb = new Set(b.split("\n"));
      const onlyA = [...sa].filter((l) => !sb.has(l)).slice(0, 15);
      const onlyB = [...sb].filter((l) => !sa.has(l)).slice(0, 15);
      const msg =
        `Schema divergence between fresh-baseline (A) and baseline+reconcile (B):\n` +
        onlyA.map((l) => `  -A ${l}`).join("\n") +
        (onlyA.length ? "\n" : "") +
        onlyB.map((l) => `  +B ${l}`).join("\n");
      expect(a, msg).toEqual(b);
    }
    expect(a).toEqual(b);
  });
});
