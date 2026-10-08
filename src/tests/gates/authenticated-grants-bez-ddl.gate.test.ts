/**
 * Gate: `authenticated` never holds TRUNCATE / REFERENCES / TRIGGER on a relation.
 *
 * Why this exists: the per-object grant files came from a pg_dump-style
 * extraction that gave `authenticated` the uniform 7-privilege grant (measured
 * 2026-10-08: 254 files). SELECT/INSERT/UPDATE/DELETE are RLS-gated — the row
 * policies are the fence for signed-in users — but the other three are NOT:
 *   - TRUNCATE empties the whole table regardless of row policies,
 *   - TRIGGER lets the holder attach triggers to the table,
 *   - REFERENCES lets the holder point foreign keys at it.
 * No client path needs them: PostgREST never issues them and the only SoT
 * functions that TRUNCATE are SECURITY DEFINER (they run as the owner).
 *
 * The sibling gate `anon-grants-select-only` holds the anon floor; this one
 * holds the authenticated floor. The scope-down is applied by
 * scripts/db/scope-authenticated-grants-rls-only.mjs (idempotent); the heal at
 * the end of heals.sql delivers it to running databases.
 *
 * Allowed for authenticated: any subset of SELECT, INSERT, UPDATE, DELETE on
 * relations; EXECUTE on functions; USAGE on schemas/sequences.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf-8");

const GRANTS_DIR = "aisha/db/sql/grants";
const BASELINE = "aisha/db/migrations/00000000000000_baseline.sql";
const HEALS = "aisha/db/heals.sql";
const INFRA_INIT = "infra/postgres/000_init_roles_schemas.sql";

/** Privileges RLS does not gate — `ALL` includes them. */
const NOT_RLS_GATED = /\b(ALL|TRUNCATE|REFERENCES|TRIGGER)\b/i;

function stripLineComments(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

/** Plain `GRANT … ON <relation> TO …authenticated…` carrying a non-RLS privilege. */
function findBroadAuthenticatedGrants(sql: string): string[] {
  const offenders: string[] = [];
  for (const rawStmt of stripLineComments(sql).split(";")) {
    const stmt = rawStmt.replace(/\s+/g, " ").trim();
    const m = stmt.match(/^GRANT\s+(.+?)\s+ON\s+(.+?)\s+TO\s+(.+)$/i);
    if (!m) continue;
    const [, privs, obj, grantees] = m;
    if (!/\bauthenticated\b/i.test(grantees)) continue;
    if (/^(FUNCTION|ALL\s+FUNCTIONS|SCHEMA|SEQUENCE|ALL\s+SEQUENCES)\b/i.test(obj)) continue;
    if (NOT_RLS_GATED.test(privs)) offenders.push(`${privs} ON ${obj} TO ${grantees}`);
  }
  return offenders;
}

/** Grants built inside DO-blocks via format('GRANT … TO authenticated'). */
function findBroadDynamicAuthenticatedGrants(sql: string): string[] {
  const offenders: string[] = [];
  const re = /format\s*\(\s*'(GRANT\s+[^']*?TO\s+[^']*?\bauthenticated\b[^']*?)'/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    const inner = m[1].replace(/\s+/g, " ");
    const g = inner.match(/^GRANT\s+(.+?)\s+ON\s+(.+?)\s+TO\s+/i);
    if (!g || /^(FUNCTION|SCHEMA|SEQUENCE)\b/i.test(g[2])) continue;
    if (NOT_RLS_GATED.test(g[1])) offenders.push(inner);
  }
  return offenders;
}

/** ALTER DEFAULT PRIVILEGES … GRANT … ON TABLES TO authenticated (future tables). */
function findBroadAuthenticatedDefaultPrivileges(sql: string): string[] {
  const offenders: string[] = [];
  for (const rawStmt of stripLineComments(sql).split(";")) {
    const stmt = rawStmt.replace(/\s+/g, " ").trim();
    const m = stmt.match(/^ALTER DEFAULT PRIVILEGES\b.*\bGRANT\s+(.+?)\s+ON\s+TABLES\s+TO\s+(.+)$/i);
    if (!m) continue;
    const [, privs, grantees] = m;
    if (/\bauthenticated\b/i.test(grantees) && NOT_RLS_GATED.test(privs)) offenders.push(stmt);
  }
  return offenders;
}

function scanAll(sql: string): string[] {
  return [
    ...findBroadAuthenticatedGrants(sql),
    ...findBroadDynamicAuthenticatedGrants(sql),
    ...findBroadAuthenticatedDefaultPrivileges(sql),
  ];
}

describe("authenticated grants — no privilege that RLS does not gate", () => {
  test("detector recognises the pg_dump-era grant and accepts the scoped one", () => {
    expect(
      findBroadAuthenticatedGrants(
        "GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.t TO authenticated;",
      ),
    ).toHaveLength(1);
    expect(findBroadAuthenticatedGrants("GRANT ALL ON storage.objects TO authenticated, service_role;")).toHaveLength(1);
    expect(findBroadAuthenticatedGrants("GRANT DELETE, INSERT, SELECT, UPDATE ON public.t TO authenticated;")).toHaveLength(0);
    expect(findBroadAuthenticatedGrants("GRANT ALL ON public.t TO service_role;")).toHaveLength(0);
    expect(findBroadAuthenticatedGrants("GRANT EXECUTE ON FUNCTION public.f() TO authenticated;")).toHaveLength(0);
  });

  test("no SoT grant file gives authenticated TRUNCATE/REFERENCES/TRIGGER/ALL", () => {
    const offenders: string[] = [];
    for (const f of readdirSync(join(ROOT, GRANTS_DIR))) {
      if (!f.endsWith(".sql")) continue;
      for (const o of scanAll(read(`${GRANTS_DIR}/${f}`))) offenders.push(`${f}: ${o}`);
    }
    expect(
      offenders,
      "authenticated may hold only RLS-gated privileges (SELECT/INSERT/UPDATE/DELETE) on relations.\n" +
        "Run scripts/db/scope-authenticated-grants-rls-only.mjs, then npm run db:init:generate.\n" +
        `Offenders:\n  ${offenders.join("\n  ")}`,
    ).toHaveLength(0);
  });

  test("storage tables from the infra init carry the same floor", () => {
    expect(scanAll(read(INFRA_INIT))).toEqual([]);
  });

  test("generated baseline carries no such grant (regen drift guard)", () => {
    const offenders = scanAll(read(BASELINE));
    expect(
      offenders,
      `baseline must be regenerated from the scoped SoT (npm run db:init:generate), never hand-edited.\n  ${offenders.join("\n  ")}`,
    ).toHaveLength(0);
  });

  test("heals.sql revokes them on running databases (public + storage + default privileges)", () => {
    const heals = stripLineComments(read(HEALS)).replace(/\s+/g, " ");
    expect(heals).toMatch(/REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM authenticated;/);
    expect(heals).toMatch(/REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA storage FROM authenticated;/);
    expect(heals).toMatch(
      /ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM authenticated;/,
    );
  });
});
