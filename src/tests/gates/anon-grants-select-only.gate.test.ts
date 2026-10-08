/**
 * Gate: anon table grants are SELECT-only across the whole DB SoT (least privilege).
 *
 * Why this exists: the per-object grant files in aisha/db/sql/grants/ were
 * originally produced by a pg_dump-style extraction that emitted a uniform
 * 7-privilege grant (DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE,
 * UPDATE) to anon/authenticated/service_role alike. For the anon
 * (unauthenticated) role that is a least-privilege violation and a
 * defense-in-depth gap:
 *   - INSERT/UPDATE/DELETE are at least gated by RLS, but
 *   - TRUNCATE / REFERENCES / TRIGGER are NOT subject to RLS — a role holding
 *     them can wipe or alter a table regardless of row policies.
 *
 * RLS cross-check (verified before the scope-down): every write policy that
 * applies to anon/public is gated on auth.uid() / is_admin_or_staff() / owner
 * / service_role / check(false) — none satisfiable by anon (auth.uid() IS
 * NULL). There is NO legitimate anon WRITE path. anon SELECT-only is the
 * correct floor, and it is exactly what the fix_missing_table_grants.sql
 * cold-start DO-loop grants.
 *
 * The scope-down is applied by scripts/db/scope-anon-grants-select-only.mjs
 * (idempotent). This gate keeps it from regressing: a future pg_dump-style
 * regeneration of the grant files (or a hand-added broad grant) fails here
 * before it ever reaches a cold-start.
 *
 * What is intentionally ALLOWED for anon:
 *   - GRANT SELECT ON <table/view>              (public read, still RLS-gated)
 *   - GRANT EXECUTE ON FUNCTION ...             (public RPCs — SECURITY DEFINER
 *                                                pattern audited elsewhere by
 *                                                definer-rpc-security.gate)
 *   - GRANT USAGE ON SCHEMA ...                 (namespace visibility)
 *   - CREATE POLICY ... FOR SELECT TO anon      (RLS read policies)
 *   - ALTER DEFAULT PRIVILEGES ... GRANT SELECT ON TABLES TO anon
 *
 * If a genuinely new anon privilege class is ever needed, extend this gate
 * consciously in the same commit that introduces it — never delete the gate.
 *
 * ⛔ POHLEDY (doplněno 2026-10-06). „anon smí SELECT" NEPLATÍ pro pohled s právy
 * VLASTNÍKA (bez security_invoker): ten čte podklad MIMO jeho RLS, takže SELECT
 * pro klienta tam není „RLS-gated read", ale zadní vrátka kolem všech policies.
 * Naměřeno na čisté DB main 0f992f647: 11 takových pohledů četl anon (souhrny stavu
 * ze snímačů každého vlastníka, kohorty, zásilky…), dalších 12 authenticated.
 * Pravidla (SoT: grant soubory, soubory pohledů, heals, baseline):
 *   - anon smí SELECT jen na pohled VYJMENOVANÝ v pohledy-verejne-pro-cteni.json,
 *   - authenticated smí SELECT na pohled s právy vlastníka jen tamtéž,
 *   - DML na pohled s právy vlastníka nesmí klient NIKDY (auto-updatable pohled
 *     zapisuje mimo RLS podkladu).
 * Statická brána nevidí ALTER DEFAULT PRIVILEGES ani pořadí GRANT/REVOKE — to měří
 * katalog živé DB v src/tests/db/pohled-s-pravy-vlastnika-bez-klientskeho-grantu
 * .runtime.test.ts nad týmž výčtem. Tady jde o rychlou zpětnou vazbu v PR.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf-8");

const GRANTS_DIR = "aisha/db/sql/grants";
const BASELINE = "aisha/db/migrations/00000000000000_baseline.sql";

/** Strip `-- ...` line comments so commented-out grants don't trip the gate. */
function stripLineComments(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

/**
 * Find GRANT statements addressed to anon whose privilege set is anything
 * other than plain SELECT (functions/EXECUTE and schema USAGE are allowed).
 * Works statement-wise so multi-line grants are handled.
 */
function findBroadAnonGrants(sql: string): string[] {
  const offenders: string[] = [];
  for (const rawStmt of stripLineComments(sql).split(";")) {
    const stmt = rawStmt.replace(/\s+/g, " ").trim();
    if (!stmt) continue;

    // Plain GRANT statements (not ALTER DEFAULT PRIVILEGES — tested separately).
    const m = stmt.match(/^GRANT\s+(.+?)\s+ON\s+(.+?)\s+TO\s+(.+)$/i);
    if (!m) continue;
    const [, privs, obj, grantees] = m;
    if (!/\banon\b/i.test(grantees)) continue;
    if (/^FUNCTION\b/i.test(obj) || /\bEXECUTE\b/i.test(privs)) continue; // public RPCs
    if (/^SCHEMA\b/i.test(obj) && /^USAGE$/i.test(privs.trim())) continue; // namespace

    const privSet = privs
      .split(",")
      .map((p) => p.trim().toUpperCase())
      .filter(Boolean)
      .sort()
      .join(",");
    if (privSet !== "SELECT") offenders.push(`${privs} ON ${obj}`);
  }
  return offenders;
}

/**
 * Grants built dynamically inside DO-blocks via format('GRANT … TO anon').
 * These bypass statement-level parsing, so scan the format strings directly.
 */
function findBroadDynamicAnonGrants(sql: string): string[] {
  const offenders: string[] = [];
  const re = /format\s*\(\s*'(GRANT\s+[^']*?TO\s+anon[^']*?)'/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    const inner = m[1].replace(/\s+/g, " ");
    const g = inner.match(/^GRANT\s+(.+?)\s+ON\s+/i);
    if (g && g[1].trim().toUpperCase() !== "SELECT") offenders.push(inner);
  }
  return offenders;
}

/** ALTER DEFAULT PRIVILEGES … TO anon must grant SELECT only (future tables). */
function findBroadAnonDefaultPrivileges(sql: string): string[] {
  const offenders: string[] = [];
  for (const rawStmt of stripLineComments(sql).split(";")) {
    const stmt = rawStmt.replace(/\s+/g, " ").trim();
    const m = stmt.match(
      /^ALTER DEFAULT PRIVILEGES\b.*\bGRANT\s+(.+?)\s+ON\s+TABLES\s+TO\s+(.+)$/i,
    );
    if (!m) continue;
    const [, privs, grantees] = m;
    if (!/\banon\b/i.test(grantees)) continue;
    if (privs.trim().toUpperCase() !== "SELECT") offenders.push(stmt);
  }
  return offenders;
}

// ── Pohledy s právy vlastníka (doplněno 2026-10-06) ─────────────────────────
const VEREJNE_JSON = "src/tests/gates/pohledy-verejne-pro-cteni.json";
const HEALS = "aisha/db/heals.sql";
const POHLEDY_DIRS = ["aisha/db/sql/views", "aisha/db/sql/materialized_views"];

interface Pohled {
  invoker: boolean;
}

/** Pohledy ze SoT (jméno → security_invoker?) a výčet vědomě veřejných. */
function pohledyZeSoT(): {
  pohledy: Map<string, Pohled>;
  verejne: Map<string, string[]>;
  duvody: Map<string, string>;
} {
  const pohledy = new Map<string, Pohled>();
  for (const dir of POHLEDY_DIRS) {
    for (const f of readdirSync(join(ROOT, dir))) {
      if (!f.endsWith(".sql")) continue;
      const sql = stripLineComments(read(`${dir}/${f}`));
      const re =
        /CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-z0-9_]+)"?([^;]*?)\bAS\b/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(sql)) !== null) {
        const invoker =
          /security_invoker\s*=\s*(?:true|on|1)/i.test(m[2]) ||
          new RegExp(`ALTER\\s+VIEW\\s+(?:public\\.)?${m[1]}\\s+SET\\s*\\([^)]*security_invoker\\s*=\\s*(?:true|on|1)`, "i").test(sql);
        pohledy.set(m[1].toLowerCase(), { invoker });
      }
    }
  }
  const json = JSON.parse(read(VEREJNE_JSON)) as {
    verejne: Record<string, { role: string[]; duvod: string }>;
  };
  const verejne = new Map(Object.entries(json.verejne).map(([k, v]) => [k, v.role]));
  const duvody = new Map(Object.entries(json.verejne).map(([k, v]) => [k, v.duvod ?? ""]));
  return { pohledy, verejne, duvody };
}

/** Odkud granty na běžící / čerstvou DB přicházejí (bez ALTER DEFAULT PRIVILEGES — to měří runtime). */
function zdrojeGrantu(): string[] {
  const out = [HEALS, BASELINE];
  for (const dir of [GRANTS_DIR, ...POHLEDY_DIRS]) {
    for (const f of readdirSync(join(ROOT, dir))) if (f.endsWith(".sql")) out.push(`${dir}/${f}`);
  }
  return out;
}

/** GRANTy (příkaz po příkazu) mířící na známý pohled: jméno, práva, role. */
function grantyNaPohledy(
  sql: string,
  pohledy: Map<string, Pohled>,
): Array<{ pohled: string; prava: string[]; role: string[] }> {
  const out: Array<{ pohled: string; prava: string[]; role: string[] }> = [];
  for (const rawStmt of stripLineComments(sql).split(";")) {
    const stmt = rawStmt.replace(/\s+/g, " ").trim();
    const m = stmt.match(/^GRANT\s+(.+?)\s+ON\s+(?:TABLE\s+)?(.+?)\s+TO\s+(.+)$/i);
    if (!m) continue;
    const [, privs, objs, grantees] = m;
    if (/^(FUNCTION|SCHEMA|SEQUENCE|ALL\s)/i.test(objs)) continue;
    const prava = privs.split(",").map((p) => p.trim().toUpperCase()).filter(Boolean);
    const role = grantees
      .replace(/\s+WITH\s+GRANT\s+OPTION$/i, "")
      .split(",")
      .map((r) => r.trim().toLowerCase().replace(/"/g, ""));
    for (const o of objs.split(",")) {
      const jmeno = o.trim().replace(/^public\./i, "").replace(/"/g, "").toLowerCase();
      if (pohledy.has(jmeno)) out.push({ pohled: jmeno, prava, role });
    }
  }
  return out;
}

describe("anon grants — SELECT-only least-privilege floor", () => {
  test("no SoT grant file grants anon anything beyond SELECT on a relation", () => {
    const offenders: string[] = [];
    for (const f of readdirSync(join(ROOT, GRANTS_DIR))) {
      if (!f.endsWith(".sql")) continue;
      const body = read(`${GRANTS_DIR}/${f}`);
      for (const o of findBroadAnonGrants(body)) offenders.push(`${f}: ${o}`);
      for (const o of findBroadDynamicAnonGrants(body)) offenders.push(`${f}: ${o}`);
    }
    expect(
      offenders,
      `anon must hold SELECT only on relations (TRUNCATE/REFERENCES/TRIGGER are not RLS-gated; writes have no anon path).\n` +
        `Run scripts/db/scope-anon-grants-select-only.mjs, then npm run db:init:generate.\nOffenders:\n  ${offenders.join("\n  ")}`,
    ).toHaveLength(0);
  });

  test("default privileges for future tables give anon SELECT only (SoT)", () => {
    const offenders: string[] = [];
    for (const f of readdirSync(join(ROOT, GRANTS_DIR))) {
      if (!f.endsWith(".sql")) continue;
      for (const o of findBroadAnonDefaultPrivileges(read(`${GRANTS_DIR}/${f}`)))
        offenders.push(`${f}: ${o}`);
    }
    expect(offenders, offenders.join("\n")).toHaveLength(0);
  });

  test("cold-start blanket loop grants anon SELECT only (fix_missing_table_grants.sql)", () => {
    const sql = read(`${GRANTS_DIR}/fix_missing_table_grants.sql`);
    expect(findBroadDynamicAnonGrants(sql), "DO-loop must grant anon SELECT only").toHaveLength(0);
    expect(findBroadAnonDefaultPrivileges(sql)).toHaveLength(0);
  });

  test("klient nečte pohled s právy vlastníka, který není vyjmenovaný jako veřejný (SoT + heals + baseline)", () => {
    const { pohledy, verejne } = pohledyZeSoT();
    expect(pohledy.size, "měřidlo nenašlo žádný pohled — měří nad ničím").toBeGreaterThan(40);

    const offenders: string[] = [];
    for (const zdroj of zdrojeGrantu()) {
      for (const g of grantyNaPohledy(read(zdroj), pohledy)) {
        const p = pohledy.get(g.pohled)!;
        const povoleno = verejne.get(g.pohled) ?? [];
        for (const role of g.role) {
          if (role !== "anon" && role !== "authenticated") continue;
          const jenCteni = g.prava.every((x) => x === "SELECT");
          if (!jenCteni && !p.invoker) {
            offenders.push(`${zdroj}: ${g.prava.join(",")} ON ${g.pohled} TO ${role} — DML na pohled s právy vlastníka`);
            continue;
          }
          if (role === "anon" && !povoleno.includes("anon")) {
            offenders.push(`${zdroj}: SELECT ON ${g.pohled} TO anon — pohled není vyjmenovaný jako veřejný`);
          }
          if (role === "authenticated" && !p.invoker && !povoleno.includes("authenticated")) {
            offenders.push(`${zdroj}: SELECT ON ${g.pohled} TO authenticated — pohled s právy vlastníka mimo výčet veřejných`);
          }
        }
      }
    }
    expect(
      offenders,
      `Pohled bez security_invoker čte podklad MIMO RLS — klientský grant je zadní vrátka.\n` +
        `Oprav: security_invoker = true (platí RLS podkladu), nebo REVOKE z klientů a čtení přes ` +
        `SECURITY DEFINER funkci se strážemi; veřejná projekce jen vědomě do ${VEREJNE_JSON}.\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  test("výčet veřejných pohledů je živý: každá položka existuje, běží s právy vlastníka a má důvod", () => {
    const { pohledy, verejne, duvody } = pohledyZeSoT();
    const vady: string[] = [];
    for (const [jmeno, role] of verejne) {
      const p = pohledy.get(jmeno);
      if (!p) vady.push(`${jmeno}: pohled v SoT neexistuje — smaž položku`);
      else if (p.invoker) vady.push(`${jmeno}: má security_invoker, výjimku nepotřebuje — smaž položku`);
      if (role.some((r) => r !== "anon" && r !== "authenticated")) vady.push(`${jmeno}: neznámá role ${role.join(",")}`);
      if ((duvody.get(jmeno) ?? "").length < 60) vady.push(`${jmeno}: důvod musí vysvětlit, proč je čtení klientem účel`);
    }
    expect(vady).toEqual([]);
  });

  test("generated baseline carries no anon grant beyond SELECT (regen drift guard)", () => {
    const base = read(BASELINE);
    const offenders = [
      ...findBroadAnonGrants(base),
      ...findBroadDynamicAnonGrants(base),
      ...findBroadAnonDefaultPrivileges(base),
    ];
    expect(
      offenders,
      `baseline must be regenerated from scoped SoT (npm run db:init:generate) — never hand-edited.\nOffenders:\n  ${offenders.join("\n  ")}`,
    ).toHaveLength(0);
  });
});
