/**
 * NOVÁ AGENDA ZDROJE → NÁVRH „NAŠE FIRMA" ke schválení.
 *
 * ⭐ ROZHODNUTÍ MAJITELE 2026-09-28: „až příště přidáme novou agendu z Money… aby nám to
 * odhalil a doporučil ve správě ingestu a stačilo to jen potvrdit". Instance zdroje (záznam
 * konektoru `_instance`), která se poprvé objeví v datech, dostane návrh twin_external_refs
 * `nase_firma` (proposed) na firmě téhož jména — jinak se firma založí. Potvrzený název je
 * schválený název firmy. Rozhodnutí člověka (i zamítnutí) se znovu nenavrhuje.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

const dbAvailable = isPgReachable();
const RUN = randomUUID().slice(0, 8);
const NOVA = `ZZ Nova agenda ${RUN}`;
const ZNAMA = `ZZ Znama firma ${RUN} a.s.`;
const ZAMITNUTA = `ZZ Zamitnuta ${RUN}`;
const ZNAMA_TWIN = randomUUID();
const ADMIN = randomUUID();
const DOKLADY: string[] = [];

function psql(sql: string): string {
  return execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tA"],
    { input: `${sql};`, encoding: "utf-8", env: { ...process.env, PGPASSWORD: PG_PASSWORD } },
  ).trim();
}
const jakoAdmin = (sql: string) =>
  execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tA"],
    {
      input: `\\o /dev/null\nSET request.jwt.claims = '{"sub":"${ADMIN}","role":"authenticated"}';\nSET ROLE authenticated;\n\\o\n${sql};`,
      encoding: "utf-8",
      env: { ...process.env, PGPASSWORD: PG_PASSWORD },
    },
  ).trim();

/** Doklad z konektoru s instancí — tak ho zapíše ingest. */
const doklad = (instance: string) => {
  const slug = `nf-${RUN}-${DOKLADY.length}`;
  DOKLADY.push(slug);
  const raw = JSON.stringify({ source_record: { _instance: instance, _marker: "money.faktura_vydana", ID: slug } }).replace(/'/g, "''");
  psql(`INSERT INTO public.li_source_registry (doc_slug, source_sha256, doc_type, doc_class, fields, raw_data)
        VALUES ('${slug}', 'sha-${slug}', 'invoice', 'transactional', '{}'::jsonb, '${raw}'::jsonb)`);
};
const navrhy = (jmeno: string) =>
  psql(`SELECT coalesce(string_agg(r.state || ':' || t.label, ',' ORDER BY r.created_at), '')
          FROM public.twin_external_refs r JOIN public.twin_entities t ON t.id = r.twin_id
         WHERE r.ref_kind = 'nase_firma' AND r.source = 'money' AND r.source_key = '${jmeno}'`);

beforeAll(() => {
  if (!dbAvailable) return;
  psql(`INSERT INTO aisha_auth.users (id, email) VALUES ('${ADMIN}', 'nf-admin-${RUN}@test.local')`);
  psql(`INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin')`);
  psql(`INSERT INTO public.twin_entities (id, entity_type, label) VALUES ('${ZNAMA_TWIN}', 'company', '${ZNAMA}')`);
});

afterAll(() => {
  if (!dbAvailable) return;
  psql(`DELETE FROM public.li_source_registry WHERE doc_slug LIKE 'nf-${RUN}-%'`);
  psql(`DELETE FROM public.twin_external_refs WHERE ref_kind = 'nase_firma' AND source_key IN ('${NOVA}','${ZNAMA}','${ZAMITNUTA}')`);
  psql(`DELETE FROM public.twin_entities WHERE label IN ('${NOVA}','${ZNAMA}','${ZAMITNUTA}')`);
  psql(`DELETE FROM public.user_roles WHERE user_id = '${ADMIN}'`);
  psql(`DELETE FROM aisha_auth.users WHERE id = '${ADMIN}'`);
});

describe.skipIf(!dbAvailable)("nová agenda zdroje → návrh „naše firma“", () => {
  it("⭐ první doklad nové instance vytvoří JEDEN návrh na nové firmě téhož jména", () => {
    doklad(NOVA);
    expect(navrhy(NOVA)).toBe(`proposed:${NOVA}`);
    doklad(NOVA);
    expect(navrhy(NOVA)).toBe(`proposed:${NOVA}`);
  });

  it("⭐ firma téhož jména už existuje → návrh padne na ni, nová se nezakládá", () => {
    doklad(ZNAMA);
    expect(navrhy(ZNAMA)).toBe(`proposed:${ZNAMA}`);
    expect(psql(`SELECT count(*) FROM public.twin_entities WHERE label = '${ZNAMA}'`)).toBe("1");
    expect(psql(`SELECT twin_id FROM public.twin_external_refs WHERE ref_kind = 'nase_firma' AND source_key = '${ZNAMA}'`)).toBe(ZNAMA_TWIN);
  });

  it("⛔ zamítnutý návrh se s dalším dokladem nevrátí", () => {
    doklad(ZAMITNUTA);
    psql(`UPDATE public.twin_external_refs SET state = 'rejected' WHERE ref_kind = 'nase_firma' AND source_key = '${ZAMITNUTA}'`);
    doklad(ZAMITNUTA);
    expect(navrhy(ZAMITNUTA)).toBe(`rejected:${ZAMITNUTA}`);
  });

  it("⭐ správa návrh vidí ve frontě identifikátorů (zdroj money) a potvrzením je název schválený", () => {
    const fronta = jakoAdmin(`SELECT public.get_twin_ref_review_block('{"source":"money","entity_type":"company","title_template":"{label}","quote_template":"naše firma?{note}"}'::jsonb)::text`);
    expect(fronta).toContain(NOVA);
    expect(fronta).toContain('"entity_kind": "twin_identity"');
    const ref = psql(`SELECT id FROM public.twin_external_refs WHERE ref_kind = 'nase_firma' AND source_key = '${NOVA}'`);
    jakoAdmin(`SELECT public.submit_evidence_review_audited('twin_identity', '${ref}', 'confirmed')`);
    expect(navrhy(NOVA)).toBe(`confirmed:${NOVA}`);
    const twin = psql(`SELECT twin_id FROM public.twin_external_refs WHERE id = '${ref}'`);
    expect(psql(`SELECT label FROM public.counterparty_resolve('{"twin_id":"${twin}"}'::jsonb)`)).toBe(NOVA);
  });

  it("jednorázové doplnění (migrace) je idempotentní — nic, o čem se rozhodlo, znovu nenavrhne", () => {
    expect(psql(`SELECT public.navrhni_nase_firmy_z_agend(ARRAY['money/${NOVA}','money/${ZNAMA}','money/${ZAMITNUTA}'])`)).toBe("0");
  });

  it("⛔ běžný přihlášený funkci návrhu volat nesmí (jen vlastník: trigger, migrace)", () => {
    expect(() => jakoAdmin(`SELECT public.navrhni_nase_firmy_z_agend()`)).toThrow(/permission denied/);
  });
});
