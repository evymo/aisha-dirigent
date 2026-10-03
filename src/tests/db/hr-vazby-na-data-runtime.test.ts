/**
 * VAZBY NA DATA v Lidé a účty: správa naváže osobu účtu na identitu a účet
 * pak vidí doklady té identity (nárok z vazeb); odebráním vazby je ztratí.
 *
 * ⭐ Rozhodnutí majitele 2026-09-28: „k čemu v extranetu a vazby na data se
 * uživatel dostane" nastavuje správa u uživatele. Sekce = udělení, data = vazba.
 *
 * ⭐ CO SE MĚŘÍ: účet bez osoby ji dostane s první vazbou; vazba otevře právě
 * doklady identity; druh vazby, který pravidla neznají, se nezaloží; odebrání
 * vazby nárok vezme; hledání a přehled vrací počet potvrzených identifikátorů;
 * vše jen správou.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

const dbAvailable = isPgReachable();
const RUN = randomUUID().replace(/-/g, "").slice(0, 8);
const DRUH = `zz_spravuje_${RUN}`;
const ADMIN = randomUUID();
const CLEN = randomUUID();
const FIRMA = randomUUID();
const JMENO = `ZZ Vazby firma ${RUN}`;
const DOKLAD = `zz-vazby-${RUN}`;

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
const vidiDoklad = () =>
  jako(CLEN, `SELECT count(*) FROM public.li_source_registry WHERE doc_slug = '${DOKLAD}'`) === "1";
const prehled = () => JSON.parse(jako(ADMIN, `SELECT public.hr_vazby_uctu_admin('${CLEN}')::text`));

beforeAll(() => {
  if (!dbAvailable) return;
  svc(`INSERT INTO aisha_auth.users (id, email) VALUES
         ('${ADMIN}','vazby-hr-admin-${RUN}@test.local'), ('${CLEN}','vazby-hr-clen-${RUN}@test.local')
       ON CONFLICT (id) DO NOTHING`);
  svc(`INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin') ON CONFLICT DO NOTHING`);
  svc(`INSERT INTO public.twin_entities (id, entity_type, label) VALUES ('${FIRMA}','company','${JMENO}')`);
  svc(`INSERT INTO public.twin_external_refs (twin_id, ref_kind, source, source_key, state, proposed_by, confirmed_at, valid_from)
       VALUES ('${FIRMA}','company_name','hr','${JMENO}','confirmed','vazby-hr-test', now() - interval '1 day', now() - interval '1 day')`);
  svc(`INSERT INTO public.twin_scope_doc_rules (relation_kind, doc_type, field_key, ref_kinds)
       VALUES ('${DRUH}','invoice','owner_company', ARRAY['company_name'])`);
  svc(`INSERT INTO public.li_source_registry (doc_slug, source_sha256, doc_type, fields)
       VALUES ('${DOKLAD}','sha-${DOKLAD}','invoice','{"owner_company":{"value":"${JMENO}"}}'::jsonb)`);
});

afterAll(() => {
  if (!dbAvailable) return;
  svc(`DELETE FROM public.li_source_registry WHERE doc_slug = '${DOKLAD}'`);
  svc(`DELETE FROM public.twin_scope_doc_rules WHERE relation_kind = '${DRUH}'`);
  svc(`DELETE FROM public.twin_entities WHERE id = '${FIRMA}'
          OR id IN (SELECT twin_id FROM public.twin_external_refs WHERE ref_kind = 'account' AND source_key = '${CLEN}')`);
  svc(`DELETE FROM public.user_roles WHERE user_id = '${ADMIN}'`);
  svc(`DELETE FROM aisha_auth.users WHERE id IN ('${ADMIN}','${CLEN}')`);
});

describe.skipIf(!dbAvailable)("vazby na data v Lidé a účty", () => {
  it("přehled: účet zatím bez osoby a bez vazeb; druhy vazeb z pravidel", () => {
    const p = prehled();
    expect(p.osoba).toBeNull();
    expect(p.vazby).toEqual([]);
    expect(p.druhy).toContain(DRUH);
    expect(vidiDoklad()).toBe(false);
  });

  it("hledání identit vrací identitu s počtem potvrzených identifikátorů", () => {
    const n = JSON.parse(jako(ADMIN, `SELECT public.hr_identity_hledat_admin('Vazby firma ${RUN}', 10)::text`));
    expect(n).toContainEqual(expect.objectContaining({ twin_id: FIRMA, identifikatoru: 1 }));
  });

  it("⛔ jen správa přiřazuje a čte vazby", () => {
    expect(() => jako(CLEN, `SELECT public.hr_prirad_identitu_admin('${DRUH}', '${FIRMA}', '${CLEN}')`)).toThrow(/Unauthorized/);
    expect(() => jako(CLEN, `SELECT public.hr_vazby_uctu_admin('${CLEN}')`)).toThrow(/Unauthorized/);
  });

  it("⛔ druh vazby, který pravidla nároku neznají, se nezaloží", () => {
    expect(() => jako(ADMIN, `SELECT public.hr_prirad_identitu_admin('zz_neznamy_${RUN}', '${FIRMA}', '${CLEN}')`)).toThrow(
      /relation_kind_bez_pravidla/,
    );
  });

  it("⭐ přiřazení: účet dostane osobu, vznikne vazba a účet vidí doklady identity", () => {
    const r = JSON.parse(jako(ADMIN, `SELECT public.hr_prirad_identitu_admin('${DRUH}', '${FIRMA}', '${CLEN}')::text`));
    expect(r).toMatchObject({ ok: true, uz_existuje: false });
    const p = prehled();
    expect(p.osoba).not.toBeNull();
    expect(p.vazby).toEqual([expect.objectContaining({ twin_id: FIRMA, relation_kind: DRUH, identifikatoru: 1 })]);
    expect(vidiDoklad()).toBe(true);
  });

  it("opakované přiřazení je idempotentní", () => {
    const r = JSON.parse(jako(ADMIN, `SELECT public.hr_prirad_identitu_admin('${DRUH}', '${FIRMA}', '${CLEN}')::text`));
    expect(r).toMatchObject({ ok: true, uz_existuje: true });
    expect(prehled().vazby).toHaveLength(1);
  });

  it("⭐ odebrání vazby nárok vezme, historie zůstane", () => {
    const relationId = prehled().vazby[0].relation_id;
    jako(ADMIN, `SELECT public.hr_odeber_identitu_admin('${relationId}')`);
    expect(prehled().vazby).toEqual([]);
    expect(vidiDoklad()).toBe(false);
    expect(svc(`SELECT count(*) FROM public.twin_relations WHERE id = '${relationId}' AND valid_to IS NOT NULL`)).toBe("1");
  });
});
