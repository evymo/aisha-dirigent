/**
 * NÁROK Z VAZEB: „jsem spojen s identitou, které ten doklad patří."
 *
 * ⭐ ROZHODNUTÍ MAJITELE 2026-09-28: běžný uživatel (ne správa) má vidět smlouvy,
 * faktury a dlužníky jen z identit, se kterými je spojen. Řetěz:
 *   účet → osoba (potvrzená vazba účtu) → platná vazba osoby na identitu →
 *   potvrzený identifikátor identity == pole dokladu (twin_scope_doc_rules).
 *
 * ⭐ CO SE MĚŘÍ: že nový člen politik změnil PRÁVĚ JEDNU třídu identity —
 * uživatele s vazbou na identitu. Správa vidí totéž co dřív, účet bez vazby nic,
 * vazba jiného druhu nic, prošlá vazba nic, a uživatel s vazbou vidí doklady SVÉ
 * identity, ne cizí — až po blok dlužníků (SECURITY INVOKER čtečka).
 *
 * ⛔ Čte se pod `SET ROLE authenticated`: připojení je superuser, který RLS obchází.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

const dbAvailable = isPgReachable();
const RUN = randomUUID().slice(0, 8);
const CISLA = String(Date.now() % 100000).padStart(5, "0");
const DRUH = `zz_spravuje_${RUN}`;
const JINY_DRUH = `zz_jina_vazba_${RUN}`;

const ADMIN = randomUUID();
const CLEN = randomUUID();
const CIZI = randomUUID();
const JINY = randomUUID();
const PROSLY = randomUUID();

const FIRMA_A = randomUUID();
const FIRMA_B = randomUUID();
const DLUZNIK_X = randomUUID();
const DLUZNIK_Y = randomUUID();
const OSOBA_CLEN = randomUUID();
const OSOBA_JINY = randomUUID();
const OSOBA_PROSLY = randomUUID();

const JMENO_A = `ZZ Firma A ${RUN}`;
const JMENO_B = `ZZ Firma B ${RUN}`;
const ICO_A = `901${CISLA}`;
const ICO_X = `902${CISLA}`;
const ICO_Y = `903${CISLA}`;
const JMENO_X = `ZZ Dluznik X ${RUN}`;
const JMENO_Y = `ZZ Dluznik Y ${RUN}`;

const FA = `fa-${RUN}-a`;
const FB = `fa-${RUN}-b`;
const SA = `sm-${RUN}-a`;
const SN = `sm-${RUN}-bez`;
const SS = `sm-${RUN}-jmenem`;
const DOKLADY = [FA, FB, SA, SN, SS];

function psql(claims: string, sql: string, role?: string): string {
  const nastavRoli = role ? `SET ROLE ${role};\n` : "";
  return execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tA"],
    {
      input: `\\o /dev/null\nSET request.jwt.claims = '${claims}';\n${nastavRoli}\\o\n${sql};`,
      encoding: "utf-8",
      env: { ...process.env, PGPASSWORD: PG_PASSWORD },
    },
  ).trim();
}
const svc = (sql: string) => psql('{"role":"service_role"}', sql);
const jako = (uid: string, sql: string) => psql(`{"sub":"${uid}","role":"authenticated"}`, sql, "authenticated");

/** Které z NAŠICH dokladů identita vidí (ne „kolik má registr" — to by měřilo cizí data). */
const vidi = (uid: string) =>
  jako(uid, `SELECT coalesce(string_agg(doc_slug, ',' ORDER BY doc_slug), '')
               FROM public.li_source_registry WHERE doc_slug IN (${DOKLADY.map((d) => `'${d}'`).join(",")})`);
/** Která z NAŠICH dvojčat identita přečte — vrací jejich jména v testu. */
const JMENA_DVOJCAT: Record<string, string> = {
  [FIRMA_A]: "A", [FIRMA_B]: "B", [DLUZNIK_X]: "X", [DLUZNIK_Y]: "Y",
  [OSOBA_CLEN]: "osoba", [OSOBA_JINY]: "osoba-jiny",
};
const dvojcata = (uid: string) => {
  const ids = jako(uid, `SELECT coalesce(string_agg(id::text, ','), '') FROM public.twin_entities
                          WHERE id IN (${Object.keys(JMENA_DVOJCAT).map((i) => `'${i}'`).join(",")})`);
  return ids ? ids.split(",").map((i) => JMENA_DVOJCAT[i]).sort().join(",") : "";
};

const pole = (o: Record<string, string>) =>
  JSON.stringify(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: v }]))).replace(/'/g, "''");

beforeAll(() => {
  if (!dbAvailable) return;
  svc(`INSERT INTO aisha_auth.users (id, email) VALUES
         ('${ADMIN}','vazby-admin-${RUN}@test.local'), ('${CLEN}','vazby-clen-${RUN}@test.local'),
         ('${CIZI}','vazby-cizi-${RUN}@test.local'), ('${JINY}','vazby-jiny-${RUN}@test.local'),
         ('${PROSLY}','vazby-prosly-${RUN}@test.local')
       ON CONFLICT (id) DO NOTHING`);
  svc(`INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin') ON CONFLICT DO NOTHING`);

  svc(`INSERT INTO public.twin_entities (id, entity_type, label) VALUES
         ('${FIRMA_A}','company','${JMENO_A}'), ('${FIRMA_B}','company','${JMENO_B}'),
         ('${DLUZNIK_X}','company','${JMENO_X}'), ('${DLUZNIK_Y}','company','${JMENO_Y}'),
         ('${OSOBA_CLEN}','person','Osoba clen ${RUN}'), ('${OSOBA_JINY}','person','Osoba jiny ${RUN}'),
         ('${OSOBA_PROSLY}','person','Osoba prosly ${RUN}')
       ON CONFLICT (id) DO NOTHING`);

  const ucet = (twin: string, uid: string) =>
    `('${twin}','account','aisha_auth','${uid}','confirmed','vazby-test', now() - interval '1 day', now() - interval '1 day')`;
  svc(`INSERT INTO public.twin_external_refs
         (twin_id, ref_kind, source, source_key, state, proposed_by, confirmed_at, valid_from) VALUES
         ${ucet(OSOBA_CLEN, CLEN)}, ${ucet(OSOBA_JINY, JINY)}, ${ucet(OSOBA_PROSLY, PROSLY)},
         ('${FIRMA_A}','company_name','hr','${JMENO_A}','confirmed','vazby-test', now() - interval '1 day', now() - interval '1 day'),
         ('${FIRMA_A}','company_ico','hr','${ICO_A}','confirmed','vazby-test', now() - interval '1 day', now() - interval '1 day'),
         ('${FIRMA_B}','company_name','hr','${JMENO_B}','confirmed','vazby-test', now() - interval '1 day', now() - interval '1 day')`);
  // Protistrany jen NAVRŽENÉ podle IČO — tak je dnes zná ingest (counterparty_resolve bere ne-zamítnuté).
  svc(`INSERT INTO public.twin_external_refs (twin_id, ref_kind, source, source_key, state, proposed_by) VALUES
         ('${DLUZNIK_X}','company_ico','ingest','${ICO_X}','proposed','vazby-test'),
         ('${DLUZNIK_Y}','company_ico','ingest','${ICO_Y}','proposed','vazby-test')`);

  svc(`INSERT INTO public.twin_relations (source_twin_id, target_twin_id, relation_kind, valid_from, valid_to) VALUES
         ('${OSOBA_CLEN}','${FIRMA_A}','${DRUH}', now() - interval '1 day', NULL),
         ('${OSOBA_JINY}','${FIRMA_A}','${JINY_DRUH}', now() - interval '1 day', NULL),
         ('${OSOBA_PROSLY}','${FIRMA_A}','${DRUH}', now() - interval '10 days', now() - interval '2 days')`);

  svc(`INSERT INTO public.twin_scope_doc_rules (relation_kind, doc_type, field_key, ref_kinds) VALUES
         ('${DRUH}','invoice','owner_company', ARRAY['company_name']),
         ('${DRUH}','contract','supplier_id', ARRAY['company_ico'])`);

  const faktura = (firma: string, jmeno: string, ico: string) =>
    pole({ owner_company: firma, counterparty: jmeno, counterparty_id: ico, document_subtype: "issued",
           amount_unpaid: "1000", issue_date: "2025-12-01", due_date: "2026-01-01" });
  svc(`INSERT INTO public.li_source_registry (doc_slug, source_sha256, doc_type, fields) VALUES
         ('${FA}','sha-${FA}','invoice','${faktura(JMENO_A, JMENO_X, ICO_X)}'::jsonb),
         ('${FB}','sha-${FB}','invoice','${faktura(JMENO_B, JMENO_Y, ICO_Y)}'::jsonb),
         ('${SA}','sha-${SA}','contract','${pole({ supplier_id: ICO_A, counterparty: JMENO_X })}'::jsonb),
         ('${SN}','sha-${SN}','contract','${pole({ counterparty: JMENO_Y })}'::jsonb),
         ('${SS}','sha-${SS}','contract','${pole({ supplier_name: JMENO_A })}'::jsonb)
       ON CONFLICT (source_sha256) DO NOTHING`);

  const doklady = svc(`SELECT count(*) FROM public.li_source_registry WHERE doc_slug IN (${DOKLADY.map((d) => `'${d}'`).join(",")})`);
  if (doklady !== "5") throw new Error(`fixtura: doklady ${doklady}/5 — test by měřil prázdno`);
});

afterAll(() => {
  if (!dbAvailable) return;
  svc(`DELETE FROM public.li_source_registry WHERE doc_slug IN (${DOKLADY.map((d) => `'${d}'`).join(",")})`);
  svc(`DELETE FROM public.twin_scope_doc_rules WHERE relation_kind IN ('${DRUH}','${JINY_DRUH}')`);
  svc(`DELETE FROM public.twin_entities WHERE id IN ('${FIRMA_A}','${FIRMA_B}','${DLUZNIK_X}','${DLUZNIK_Y}','${OSOBA_CLEN}','${OSOBA_JINY}','${OSOBA_PROSLY}')`);
  svc(`DELETE FROM public.user_roles WHERE user_id = '${ADMIN}'`);
  svc(`DELETE FROM aisha_auth.users WHERE id IN ('${ADMIN}','${CLEN}','${CIZI}','${JINY}','${PROSLY}')`);
});

describe.skipIf(!dbAvailable)("nárok z vazeb — doklady", () => {
  it("správa vidí všech pět dokladů (její nárok se nezměnil)", () => {
    expect(vidi(ADMIN)).toBe([...DOKLADY].sort().join(","));
  });

  it("⭐ uživatel s vazbou vidí fakturu i smlouvu SVÉ identity", () => {
    expect(vidi(CLEN)).toBe([FA, SA].sort().join(","));
  });

  it("⛔ cizí identitu, smlouvu bez pronajímatele ani pole bez pravidla nevidí", () => {
    const v = vidi(CLEN);
    expect(v).not.toContain(FB);
    expect(v).not.toContain(SN);
    expect(v).not.toContain(SS);
  });

  it("⭐ nové pravidlo zpřístupní i doklad nahraný DŘÍV (přestavba klíčů), odebrané zase vezme", () => {
    svc(`INSERT INTO public.twin_scope_doc_rules (relation_kind, doc_type, field_key, ref_kinds)
         VALUES ('${DRUH}','contract','supplier_name', ARRAY['company_name'])`);
    try {
      expect(vidi(CLEN)).toBe([FA, SA, SS].sort().join(","));
    } finally {
      svc(`DELETE FROM public.twin_scope_doc_rules WHERE relation_kind = '${DRUH}' AND field_key = 'supplier_name'`);
    }
    expect(vidi(CLEN)).toBe([FA, SA].sort().join(","));
  });

  it("⛔ nahrazená verze dokladu nárok nemá; vrácená zpět ho zase má (trigger na registru)", () => {
    svc(`UPDATE public.li_source_registry SET superseded_by = 'fa-${RUN}-nova' WHERE doc_slug = '${FA}'`);
    try {
      expect(vidi(CLEN)).toBe(SA);
    } finally {
      svc(`UPDATE public.li_source_registry SET superseded_by = NULL WHERE doc_slug = '${FA}'`);
    }
    expect(vidi(CLEN)).toBe([FA, SA].sort().join(","));
  });

  it("⛔ předpočítané klíče běžný uživatel přímo nečte (jen přes funkce nároku)", () => {
    expect(() => jako(CLEN, `SELECT count(*) FROM public.li_doc_scope_keys`)).toThrow(/permission denied/);
  });

  it("⛔ účet bez vazby nevidí nic", () => {
    expect(vidi(CIZI)).toBe("");
  });

  it("⛔ vazba druhu, který pravidla neznají, nárok nezakládá", () => {
    expect(vidi(JINY)).toBe("");
  });

  it("⛔ prošlá vazba nárok nezakládá (platí TEĎ, ne kdysi)", () => {
    expect(vidi(PROSLY)).toBe("");
  });

  it("⛔ vypnuté pravidlo = nikdo nic (fail-closed, ne „všichni všechno“)", () => {
    svc(`UPDATE public.twin_scope_doc_rules SET is_active = false WHERE relation_kind = '${DRUH}'`);
    try {
      expect(vidi(CLEN)).toBe("");
    } finally {
      svc(`UPDATE public.twin_scope_doc_rules SET is_active = true WHERE relation_kind = '${DRUH}'`);
    }
  });

  it("⛔ nepotvrzený identifikátor identity nárok nezakládá", () => {
    svc(`UPDATE public.twin_external_refs SET state = 'proposed', confirmed_at = NULL
          WHERE twin_id = '${FIRMA_A}' AND ref_kind = 'company_name'`);
    try {
      expect(vidi(CLEN)).toBe(SA);
    } finally {
      svc(`UPDATE public.twin_external_refs SET state = 'confirmed', confirmed_at = now() - interval '1 day'
            WHERE twin_id = '${FIRMA_A}' AND ref_kind = 'company_name'`);
    }
  });

  it("⛔ oracle guard: cizí účet se na nárok jiného nezeptá", () => {
    expect(jako(CIZI, `SELECT count(*) FROM public.li_doc_slugs_v_rozsahu('${CLEN}')`)).toBe("0");
  });

  it("⭐ blok dlužníků (SECURITY INVOKER) ukáže jen dlužníka SVÉ identity", () => {
    const blok = jako(CLEN, `SELECT public.get_receivables_overdue('{"limit":500}'::jsonb)::text`);
    expect(blok).toContain(JMENO_X);
    expect(blok).not.toContain(JMENO_Y);
  });
});

describe.skipIf(!dbAvailable)("nárok z vazeb — dvojčata, identifikátory, vazby", () => {
  it("uživatel s vazbou čte svou identitu, svou osobu a protistranu svých dokladů", () => {
    expect(dvojcata(CLEN)).toBe(["A", "X", "osoba"].sort().join(","));
  });

  it("⛔ účet bez vazby nečte žádné z dvojčat; správa všechna", () => {
    expect(dvojcata(CIZI)).toBe("");
    expect(dvojcata(ADMIN)).toBe(["A", "B", "X", "Y", "osoba", "osoba-jiny"].sort().join(","));
  });

  it("identifikátory své identity čte, vazby ÚČTŮ ani cizí identifikátory ne", () => {
    const refs = jako(CLEN, `SELECT coalesce(string_agg(ref_kind || ':' || source_key, ',' ORDER BY ref_kind), '')
                               FROM public.twin_external_refs
                              WHERE twin_id IN ('${FIRMA_A}','${FIRMA_B}','${OSOBA_CLEN}')`);
    expect(refs).toBe(`company_ico:${ICO_A},company_name:${JMENO_A}`);
  });

  it("vlastní vazbu osoba → identita čte, vazbu jiné osoby na tutéž identitu ne", () => {
    const vazby = jako(CLEN, `SELECT coalesce(string_agg(relation_kind, ',' ORDER BY relation_kind), '')
                                FROM public.twin_relations WHERE target_twin_id = '${FIRMA_A}'`);
    expect(vazby).toBe(DRUH);
  });
});
