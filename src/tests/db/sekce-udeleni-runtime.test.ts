/**
 * PŘÍSTUP DO SEKCE: udělení u uživatele (osa publika "udeleni") × sonda dat.
 *
 * ⭐ ROZHODNUTÍ MAJITELE 2026-09-28: „přístup k datům z úhlu pohledu je jedna věc,
 * přístup do sekce extranetu je další úroveň. Stačilo by každou sekci extranetu
 * u uživatele v administraci nastavovat … a pokud nemá žádná data, která má
 * možnost vidět, není potřeba, aby danou sekci viděl, byť do ní má přístup."
 *
 * ⭐ CO SE MĚŘÍ: bez udělení sekce ani blok neexistují (menu i data), s udělením
 * ano; sonda dat sekci skryje, dokud uživatel nemá nárok na žádný doklad, a ukáže
 * ji, jakmile ho má (nárok z vazeb); správa vidí vždy; zápis udělení jen správou
 * a s auditem; chybná deklarace osy = DENY.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

const dbAvailable = isPgReachable();
const RUN = randomUUID().replace(/-/g, "").slice(0, 8);
const SEKCE = `zz_sekce_${RUN}`;
const BLOK = `zz_blok_${RUN}`;
const TYP = `zz_typ_${RUN}`;
const DRUH = `zz_spravuje_${RUN}`;

const ADMIN = randomUUID();
const CLEN = randomUUID();
const CIZI = randomUUID();
const OSOBA = randomUUID();
const FIRMA = randomUUID();
const JMENO_FIRMY = `ZZ Firma sekce ${RUN}`;
const DOKLAD = `zz-doklad-${RUN}`;

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

const vidiSekci = (uid: string) =>
  jako(uid, `SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(public.list_surface_sections()) x
                             WHERE x->>'section' = '${SEKCE}')`) === "t";
const cteBlok = (uid: string): "ok" | string => {
  try {
    jako(uid, `SELECT public.get_block_data('${BLOK}', '{}'::jsonb) IS NOT NULL`);
    return "ok";
  } catch (e) {
    return String((e as { stderr?: string }).stderr ?? e);
  }
};
const udel = (kdo: string, komu: string, ano: boolean) =>
  jako(kdo, `SELECT public.surface_udel_admin('${komu}', '${SEKCE}', ${ano})::text`);

let allowlistZalozen = false;

beforeAll(() => {
  if (!dbAvailable) return;
  svc(`INSERT INTO aisha_auth.users (id, email) VALUES
         ('${ADMIN}','sekce-admin-${RUN}@test.local'), ('${CLEN}','sekce-clen-${RUN}@test.local'),
         ('${CIZI}','sekce-cizi-${RUN}@test.local')
       ON CONFLICT (id) DO NOTHING`);
  svc(`INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin') ON CONFLICT DO NOTHING`);

  allowlistZalozen = svc(`WITH i AS (INSERT INTO public.surface_data_rpcs (rpc_name, description, is_active)
                                     VALUES ('get_receivables_overdue', 't', true)
                                     ON CONFLICT (rpc_name) DO NOTHING RETURNING 1)
                          SELECT count(*) FROM i`) === "1";
  svc(`UPDATE public.surface_data_rpcs SET is_active = true WHERE rpc_name = 'get_receivables_overdue'`);
  svc(`INSERT INTO public.surface_sections (surface, title_key, audience, is_active)
       VALUES ('${SEKCE}', 'zz.sekce', '{"udeleni":"${SEKCE}"}'::jsonb, true)`);
  svc(`INSERT INTO public.surface_blocks (block_slug, block_type, title_key, source_rpc, source_params, namespace, sensitivity, is_active)
       VALUES ('${BLOK}', 'table', 'zz.t', 'get_receivables_overdue', '{}'::jsonb, 'zz_${RUN}', 'confidential', true)`);
  svc(`INSERT INTO public.surface_layouts (surface, block_id, audience, position, is_active)
       SELECT '${SEKCE}', b.id, '{"udeleni":"${SEKCE}"}'::jsonb, 0, true
         FROM public.surface_blocks b WHERE b.block_slug = '${BLOK}'`);
});

afterAll(() => {
  if (!dbAvailable) return;
  svc(`DELETE FROM public.surface_section_grants WHERE surface = '${SEKCE}'`);
  svc(`DELETE FROM public.surface_layouts WHERE surface = '${SEKCE}'`);
  svc(`DELETE FROM public.surface_blocks WHERE block_slug = '${BLOK}'`);
  svc(`DELETE FROM public.surface_sections WHERE surface = '${SEKCE}'`);
  if (allowlistZalozen) svc(`DELETE FROM public.surface_data_rpcs WHERE rpc_name = 'get_receivables_overdue'`);
  svc(`DELETE FROM public.li_source_registry WHERE doc_slug = '${DOKLAD}'`);
  svc(`DELETE FROM public.twin_scope_doc_rules WHERE relation_kind = '${DRUH}'`);
  svc(`DELETE FROM public.twin_entities WHERE id IN ('${OSOBA}','${FIRMA}')`);
  svc(`DELETE FROM public.user_roles WHERE user_id = '${ADMIN}'`);
  svc(`DELETE FROM aisha_auth.users WHERE id IN ('${ADMIN}','${CLEN}','${CIZI}')`);
});

describe.skipIf(!dbAvailable)("přístup do sekce — udělení u uživatele", () => {
  it("bez udělení sekce v menu není a blok se nedá číst", () => {
    expect(vidiSekci(CLEN)).toBe(false);
    expect(cteBlok(CLEN)).toMatch(/block not available to caller/);
  });

  it("⛔ udělovat smí jen správa", () => {
    expect(() => udel(CLEN, CLEN, true)).toThrow(/Unauthorized/);
  });

  it("⭐ správa udělí → uživatel sekci vidí a blok čte; zápis jde do auditu", () => {
    expect(JSON.parse(udel(ADMIN, CLEN, true))).toMatchObject({ ok: true, udeleno: true, zmena: true });
    expect(vidiSekci(CLEN)).toBe(true);
    expect(cteBlok(CLEN)).toBe("ok");
    expect(svc(`SELECT count(*) FROM public.audit_journal
                 WHERE entity_type = 'surface_section_grants' AND entity_id = '${CLEN}'`)).not.toBe("0");
  });

  it("⛔ udělení platí jen tomu, komu bylo dáno", () => {
    expect(vidiSekci(CIZI)).toBe(false);
    expect(cteBlok(CIZI)).toMatch(/block not available to caller/);
  });

  it("přehled pro správu ukazuje udělitelnou sekci a stav udělení", () => {
    const seznam = JSON.parse(jako(ADMIN, `SELECT public.surface_udeleni_admin('${CLEN}')::text`));
    expect(seznam).toContainEqual(expect.objectContaining({ surface: SEKCE, udeleno: true }));
    const cizi = JSON.parse(jako(ADMIN, `SELECT public.surface_udeleni_admin('${CIZI}')::text`));
    expect(cizi).toContainEqual(expect.objectContaining({ surface: SEKCE, udeleno: false }));
  });

  it("⛔ neudělitelnou sekci udělit nejde (udělení by nic neotevřelo)", () => {
    expect(() => jako(ADMIN, `SELECT public.surface_udel_admin('${CLEN}', 'zz_neexistuje_${RUN}', true)`)).toThrow(
      /surface_not_grantable/,
    );
  });

  it("⛔ chybná deklarace osy (ne řetězec) = DENY, ne otevřeno", () => {
    svc(`UPDATE public.surface_layouts SET audience = '{"udeleni": 5}'::jsonb WHERE surface = '${SEKCE}'`);
    try {
      expect(cteBlok(CLEN)).toMatch(/block not available to caller/);
    } finally {
      svc(`UPDATE public.surface_layouts SET audience = '{"udeleni":"${SEKCE}"}'::jsonb WHERE surface = '${SEKCE}'`);
    }
  });
});

describe.skipIf(!dbAvailable)("sonda dat — sekce bez dat se neukáže", () => {
  it("sonda bez dostupných dokladů sekci skryje běžnému uživateli, správě ne", () => {
    svc(`UPDATE public.surface_sections SET presence = '{"doklady":["${TYP}"]}'::jsonb WHERE surface = '${SEKCE}'`);
    expect(vidiSekci(CLEN)).toBe(false);
    expect(vidiSekci(ADMIN)).toBe(true);
  });

  it("⭐ jakmile má uživatel na doklad nárok (z vazeb), sekce se ukáže", () => {
    svc(`INSERT INTO public.twin_entities (id, entity_type, label) VALUES
           ('${OSOBA}','person','Osoba sekce ${RUN}'), ('${FIRMA}','company','${JMENO_FIRMY}')`);
    svc(`INSERT INTO public.twin_external_refs (twin_id, ref_kind, source, source_key, state, proposed_by, confirmed_at, valid_from) VALUES
           ('${OSOBA}','account','aisha_auth','${CLEN}','confirmed','sekce-test', now() - interval '1 day', now() - interval '1 day'),
           ('${FIRMA}','company_name','hr','${JMENO_FIRMY}','confirmed','sekce-test', now() - interval '1 day', now() - interval '1 day')`);
    svc(`INSERT INTO public.twin_relations (source_twin_id, target_twin_id, relation_kind, valid_from)
         VALUES ('${OSOBA}','${FIRMA}','${DRUH}', now() - interval '1 day')`);
    svc(`INSERT INTO public.twin_scope_doc_rules (relation_kind, doc_type, field_key, ref_kinds)
         VALUES ('${DRUH}','${TYP}','owner_company', ARRAY['company_name'])`);
    svc(`INSERT INTO public.li_source_registry (doc_slug, source_sha256, doc_type, fields)
         VALUES ('${DOKLAD}','sha-${DOKLAD}','${TYP}', '{"owner_company":{"value":"${JMENO_FIRMY}"}}'::jsonb)`);
    expect(vidiSekci(CLEN)).toBe(true);
  });

  it("⛔ neznámá sonda sekci NESKRYJE (sonda není hranice přístupu)", () => {
    svc(`UPDATE public.surface_sections SET presence = '{"neznama":1}'::jsonb WHERE surface = '${SEKCE}'`);
    expect(vidiSekci(CLEN)).toBe(true);
  });

  it("odebrání udělení sekci vezme i s daty (sonda nic neotevírá)", () => {
    expect(JSON.parse(udel(ADMIN, CLEN, false))).toMatchObject({ ok: true, udeleno: false, zmena: true });
    expect(vidiSekci(CLEN)).toBe(false);
    expect(cteBlok(CLEN)).toMatch(/block not available to caller/);
  });
});
