/**
 * Brána: čtečky webu rozlišují značku podle MAPOVÁNÍ hostname, ne podle statusu profilu.
 * ============================================================================
 * VLASTNOST: pro každý hostname namapovaný na značku (branding_hostname_mapping)
 * vracejí čtečky veřejného webu stránky, výpis a útržky TÉ značky — bez ohledu
 * na to, zda je profil `published`, nebo `draft`.
 *
 * PROČ: platforma smí mít publikovanou jen JEDNU značku bez partnera (výchozí
 * resolver get_branding_profile by jinak vybíral podle pořadí publikace), takže
 * další značky instance jsou `draft` ZÁMĚRNĚ a dosažitelné jen mapováním.
 * get_branding_for_hostname to respektoval od 2026-06-01, tři čtečky stránek
 * ne — filtrovaly `bp.status = 'published'`. Naměřeno 2026-09-19 na instanci se
 * čtyřmi značkami: tři domény dostaly téma své značky a obsah globálních
 * stránek (s vyřazenými globálními stránkami dokonce ŽÁDNOU stránku). Žádná
 * chyba, jen tiše špatný web. Týž dotaz byl vepsaný čtyřikrát a opravený jednou;
 * dnes ho drží jediný pomocník resolve_brand_for_hostname().
 *
 * DVĚ ČÁSTI:
 *  1. Statická (běží vždy): každá SoT funkce, která čte web_pages podle
 *     p_hostname, rozlišuje značku přes resolve_brand_for_hostname() a nikde
 *     nefiltruje značku podle statusu; pomocník sám status nečte, je SECURITY
 *     INVOKER a EXECUTE nedává anon/authenticated/PUBLIC (nejmenší oprávnění —
 *     konzumenti jsou DEFINER, vnořené volání běží jako vlastník); heals ho
 *     zapojuje před čtečky. Mutace dokládají, že kontrola obě vady chytí.
 *  2. Živá DB (AISHA_DB_URL / DATABASE_URL, jinak describe.skip = NEPROHLÉDNUTO,
 *     ne prošlo): v transakci s ROLLBACK založí publikovanou a draft značku,
 *     stránky, výpis a útržky a JAKO anon změří vlastnost všemi čtyřmi čtečkami
 *     (včetně tématu get_branding_for_hostname) a že anon pomocníka volat nesmí.
 *     Pak do pomocníka vrátí filtr podle statusu a ověří, že měření vlastnost
 *     poruší — tedy že test regresi opravdu vidí.
 *     Spuštění: node scripts/db/with-throwaway-db.mjs -- npx vitest run \
 *       --config vitest.gates.config.ts src/tests/gates/web-znacka-podle-mapovani.gate.test.ts
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = process.cwd();
const FN_DIR = join(ROOT, "aisha/db/sql/functions");
const HEALS = join(ROOT, "aisha/db/heals.sql");
const RESOLVER = "resolve_brand_for_hostname";

const stripComments = (sql: string) => sql.replace(/--[^\n]*/g, "");

/** Čtečka webu = funkce, která čte web_pages a bere p_hostname. */
function isWebReader(sql: string): boolean {
  const code = stripComments(sql);
  return /\bFROM\s+(public\.)?web_pages\b/i.test(code) && /\bp_hostname\b/.test(code);
}

/** Nálezy pro jednu čtečku webu (prázdné = vlastnost drží). */
export function readerFindings(name: string, sql: string): string[] {
  const code = stripComments(sql);
  const out: string[] = [];
  if (!code.includes(`${RESOLVER}(`)) {
    out.push(`${name}: značku z hostname nerozlišuje přes ${RESOLVER}() — vlastní kopie dotazu se rozejde`);
  }
  if (/\bbranding_profiles\b/i.test(code) && /\bstatus\s*=\s*'published'/i.test(code.replace(/wp\.status\s*=\s*'published'/gi, ""))) {
    out.push(`${name}: filtruje značku podle statusu profilu — draft značky instance ztratí své stránky`);
  }
  return out;
}

/** Nálezy pro samotný pomocník. */
export function resolverFindings(sql: string): string[] {
  const code = stripComments(sql);
  const out: string[] = [];
  if (/\bbranding_profiles\b/i.test(code) || /\bstatus\b/i.test(code)) {
    out.push(`${RESOLVER}: čte profil nebo jeho status — autoritou je mapování, ne status`);
  }
  if (!/\bbranding_hostname_mapping\b/i.test(code)) {
    out.push(`${RESOLVER}: nečte branding_hostname_mapping`);
  }
  if (/\bSECURITY\s+DEFINER\b/i.test(code)) {
    out.push(`${RESOLVER}: je SECURITY DEFINER — konzumenti jsou DEFINER, pomocník má být INVOKER`);
  }
  if (/GRANT\s+EXECUTE\s+ON\s+FUNCTION[^;]*\bTO\b[^;]*\b(anon|authenticated|PUBLIC)\b/i.test(code)) {
    out.push(`${RESOLVER}: EXECUTE pro anon/authenticated/PUBLIC — PostgREST by ho vystavil jako veřejné RPC`);
  }
  if (!/REVOKE\s+ALL\s+ON\s+FUNCTION[^;]*\bFROM\s+PUBLIC\b/i.test(code)) {
    out.push(`${RESOLVER}: chybí REVOKE ALL … FROM PUBLIC`);
  }
  return out;
}

function sotFunctions(): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of readdirSync(FN_DIR)) if (f.endsWith(".sql")) m.set(f.replace(/\.sql$/, ""), readFileSync(join(FN_DIR, f), "utf8"));
  return m;
}

describe("web: značka podle mapování hostname (statická část)", () => {
  const fns = sotFunctions();
  const readers = [...fns.entries()].filter(([, sql]) => isWebReader(sql));

  it("najde všechny tři čtečky webu (spodní mez — prázdná množina by bránu tiše vypnula)", () => {
    const names = readers.map(([n]) => n);
    for (const n of ["get_web_page_by_slug", "get_published_web_page_index", "get_published_web_partials"]) {
      expect(names, `čtečka ${n} nebyla rozpoznána`).toContain(n);
    }
  });

  it("každá čtečka rozlišuje značku přes pomocníka a nefiltruje status profilu", () => {
    const findings = readers.flatMap(([n, sql]) => readerFindings(n, sql));
    expect(findings, findings.join("\n")).toEqual([]);
  });

  it("i get_branding_for_hostname (téma) jde přes týž pomocník — jeden resolver pro všechny čtyři", () => {
    const sql = fns.get("get_branding_for_hostname");
    expect(sql, "get_branding_for_hostname.sql chybí").toBeDefined();
    const findings = readerFindings("get_branding_for_hostname", sql!);
    expect(findings, findings.join("\n")).toEqual([]);
  });

  it("pomocník čte jen mapování, ne profil ani jeho status", () => {
    const sql = fns.get(RESOLVER);
    expect(sql, `${RESOLVER}.sql chybí`).toBeDefined();
    expect(resolverFindings(sql!)).toEqual([]);
  });

  it("heals zapojuje pomocníka před čtečky (jinak se oprava na běžící DB nepřehraje)", () => {
    const heals = readFileSync(HEALS, "utf8");
    const at = (f: string) => heals.indexOf(`\\ir sql/functions/${f}.sql`);
    expect(at(RESOLVER), `heals.sql nezapojuje ${RESOLVER}.sql`).toBeGreaterThanOrEqual(0);
    expect(at("get_branding_for_hostname"), "heals.sql nezapojuje get_branding_for_hostname.sql").toBeGreaterThanOrEqual(0);
    for (const [n] of readers) {
      expect(at(n), `heals.sql nezapojuje ${n}.sql`).toBeGreaterThanOrEqual(0);
      expect(at(RESOLVER), `${RESOLVER} musí být v heals před ${n}`).toBeLessThan(at(n));
    }
  });

  it("MUTACE: vrácení staré podmínky (status = 'published') kontrola zachytí", () => {
    const reader = fns.get("get_web_page_by_slug")!;
    const mutated = reader.replace(
      /v_brand_id\s*:=\s*public\.resolve_brand_for_hostname\(p_hostname\);/,
      `SELECT m.branding_profile_id INTO v_brand_id
         FROM public.branding_hostname_mapping m
         JOIN public.branding_profiles bp ON bp.id = m.branding_profile_id
        WHERE lower(m.hostname) = lower(trim(p_hostname)) AND bp.status = 'published' LIMIT 1;`,
    );
    expect(mutated, "mutace se neaplikovala — tvar čtečky se změnil, uprav bránu").not.toBe(reader);
    expect(readerFindings("get_web_page_by_slug (mutace)", mutated).length).toBe(2);

    const resolver = fns.get(RESOLVER)!;
    const mutatedResolver = resolver.replace(
      /FROM public\.branding_hostname_mapping m/,
      "FROM public.branding_hostname_mapping m JOIN public.branding_profiles bp ON bp.id = m.branding_profile_id AND bp.status = 'published'",
    );
    expect(mutatedResolver).not.toBe(resolver);
    expect(resolverFindings(mutatedResolver).length).toBeGreaterThan(0);
  });

  it("MUTACE: DEFINER nebo grant pro anon u pomocníka kontrola zachytí", () => {
    const resolver = fns.get(RESOLVER)!;
    // Jen řádek KÓDU — první výskyt „SECURITY INVOKER“ je v hlavičkovém komentáři.
    const definer = resolver.replace(/^SECURITY\s+INVOKER\s*$/m, "SECURITY DEFINER");
    expect(definer, "mutace se neaplikovala — pomocník nemá SECURITY INVOKER").not.toBe(resolver);
    expect(resolverFindings(definer).some((f) => f.includes("DEFINER"))).toBe(true);
    const granted = `${resolver}\nGRANT EXECUTE ON FUNCTION public.${RESOLVER}(text) TO anon;\n`;
    expect(resolverFindings(granted).some((f) => f.includes("anon"))).toBe(true);
  });
});

// ── živá DB ────────────────────────────────────────────────────────────────
const DB_URL = process.env.AISHA_DB_URL || process.env.DATABASE_URL || "";
const runDb = DB_URL ? describe : describe.skip;

/** Kontroly vlastnosti — běží JAKO anon (SET LOCAL ROLE anon), jen přes veřejné RPC. */
const CHECKS = String.raw`
  FOREACH k IN ARRAY ARRAY['pub', 'draft'] LOOP
    IF (SELECT canvas_html FROM public.get_web_page_by_slug('gate-probe', 'gate-' || k || '.example.invalid'))
       IS DISTINCT FROM '<p>' || k || '</p>' THEN v := v || ' page:' || k; END IF;
    IF (SELECT canvas_html FROM public.get_published_web_partials('gate-' || k || '.example.invalid') WHERE ref = 'gate-part')
       IS DISTINCT FROM '<p>part-' || k || '</p>' THEN v := v || ' partial:' || k; END IF;
    IF (public.get_branding_for_hostname('gate-' || k || '.example.invalid') -> 'profile' ->> 'operator_name')
       IS DISTINCT FROM 'gate-' || k THEN v := v || ' theme:' || k; END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM public.get_published_web_page_index('gate-draft.example.invalid') WHERE slug = 'gate-draft-only')
    THEN v := v || ' index:draft-missing'; END IF;
  IF EXISTS (SELECT 1 FROM public.get_published_web_page_index('gate-pub.example.invalid') WHERE slug = 'gate-draft-only')
    THEN v := v || ' index:leak-to-pub'; END IF;`;

/** Měření v transakci: vlastnost platí (jako anon); mutace pomocníka ji poruší; ROLLBACK. */
const PROBE_SQL = String.raw`
BEGIN;
SET LOCAL client_min_messages = warning;

WITH b AS (
  INSERT INTO public.branding_profiles (partner_id, status, operator_name, operator_email)
  VALUES (NULL, 'published', 'gate-pub', 'gate@example.invalid'),
         (NULL, 'draft', 'gate-draft', 'gate@example.invalid')
  RETURNING id, operator_name
), m AS (
  INSERT INTO public.branding_hostname_mapping (hostname, branding_profile_id, brand_variant)
  SELECT operator_name || '.example.invalid', id, 'gate' FROM b RETURNING 1
), p AS (
  INSERT INTO public.web_pages (slug, title_key, canvas_html, status, is_active, branding_profile_id, page_settings)
  SELECT 'gate-probe', 'gate.title', '<p>' || substr(operator_name, 6) || '</p>', 'published', true, id, '{}'::jsonb FROM b
  UNION ALL
  SELECT 'gate-part', 'gate.title', '<p>part-' || substr(operator_name, 6) || '</p>', 'published', true, id, '{"role":"partial"}'::jsonb FROM b
  UNION ALL
  SELECT 'gate-draft-only', 'gate.title', '<p>draft only</p>', 'published', true, id, '{}'::jsonb FROM b WHERE operator_name = 'gate-draft'
  RETURNING 1
)
SELECT (SELECT count(*) FROM m) + (SELECT count(*) FROM p);

-- Globální stránka téhož slugu je past: kdo značku nerozliší, dostane ji.
INSERT INTO public.web_pages (slug, title_key, canvas_html, status, is_active, branding_profile_id)
VALUES ('gate-probe', 'gate.title', '<p>global</p>', 'published', true, NULL);

SET LOCAL ROLE anon;
DO $d$ DECLARE v text := ''; k text; BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.${RESOLVER}(text)', 'EXECUTE'),
    'NEJMENŠÍ OPRÁVNĚNÍ PORUŠENO: anon smí volat ${RESOLVER}';
  ${CHECKS}
  ASSERT v = '', 'VLASTNOST PORUŠENA (anon):' || v;
END $d$;
RESET ROLE;

-- MUTACE: stará vada (filtr podle statusu profilu) vrácená do pomocníka.
CREATE OR REPLACE FUNCTION public.${RESOLVER}(p_hostname text)
RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER AS $m$
  SELECT m.branding_profile_id
  FROM public.branding_hostname_mapping m
  JOIN public.branding_profiles bp ON bp.id = m.branding_profile_id
  WHERE lower(m.hostname) = lower(trim(p_hostname)) AND bp.status = 'published'
  LIMIT 1
$m$;

SET LOCAL ROLE anon;
DO $d$ DECLARE v text := ''; k text; BEGIN
  ${CHECKS}
  ASSERT v <> '', 'MUTACE NEZACHYCENA: měření nevidí filtr podle statusu';
END $d$;

ROLLBACK;
`;

runDb("web: značka podle mapování hostname (živá DB)", () => {
  it("anon: každý namapovaný host dostane téma, stránku, výpis i útržky své značky, pomocníka volat nesmí; mutace to poruší", () => {
    const dir = mkdtempSync(join(tmpdir(), "web-znacka-"));
    try {
      const f = join(dir, "probe.sql");
      writeFileSync(f, PROBE_SQL);
      let err = "";
      try {
        execFileSync("psql", [DB_URL, "-v", "ON_ERROR_STOP=1", "-q", "-X", "-f", f], { stdio: ["ignore", "pipe", "pipe"] });
      } catch (e) {
        const x = e as { stderr?: Buffer; message: string };
        err = x.stderr?.toString() || x.message;
      }
      expect(err, err).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
