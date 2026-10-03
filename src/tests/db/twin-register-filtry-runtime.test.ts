/**
 * REGISTR TWINŮ: filtry bloku (has_param, param_eq, osa firmy) — výsledek i ODHAD.
 *
 * ⛔ NAMĚŘENO 2026-09-30 na produkci (kolo 13c). Filtry byly korelované `exists (… = t.id)`
 * pod OR. Planner je ocenil PO ŘÁDCÍCH (AlternativeSubPlan se oceňuje první, řádkovou
 * variantou), i když je spočítal jednou: odhad 132 676 935 → plný JIT u každého registru
 * (1,9–2,1 s místo 0,09–0,19 s). Rameno `doc_field` navíc prošlo celý registr dokladů
 * pro každý řádek `latest` — nájemci se zvolenou firmou 29,8 s. Oprava: nekorelované
 * `t.id in (…)` a hodnoty dokladů firmy jednou (MATERIALIZED CTE), md5 60/60 shodné.
 *
 * CO SE MĚŘÍ:
 *   1. has_param: přítomnost parametru; prázdný = bez filtru.
 *   2. param_eq: rozhoduje POSLEDNÍ hodnota; víc párů = všechny; duplicitní události
 *      téhož páru počet nenafouknou; `{}` nefiltruje; null nepropustí nic; ne-objekt
 *      (pole, řetězec) nefiltruje; číslo se porovná jako text.
 *   3. doc_field: nájemce = POSLEDNÍ IČO v protistraně PLATNÝCH dokladů firmy (nahrazený
 *      doklad ani stará hodnota IČO nestačí).
 *   4. relation: platná vazba zvoleného druhu na potvrzenou naši firmu (platnost v čase).
 *   5. člen bez rozsahu nevidí nic (RLS fail-closed) — správce ano.
 *   6. ODHAD plánu při počtech řádků z produkce (reltuples v transakci): generický plán
 *      těla funkce je pod jit_above_cost; stará korelovaná podoba ramene doc_field nad ním.
 *      Bez toho by test na malé DB prošel vždy — JIT zapíná velikost tabulek, ne tvar dotazu.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "crypto";
import { execFileSync } from "child_process";
import { unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { psqlMultiline, psqlQuery } from "./validation-utils";
import {
  PG_DATABASE, PG_HOST, PG_PASSWORD, PG_PORT, PG_USER, isPgReachable, reportTestCapabilities,
} from "./test-env-probe";

/**
 * psql pro EXPLAIN (FORMAT JSON) celého těla: plán s politikami RLS má stovky kB a
 * psqlMultiline (výchozí buffer 1 MB) padal na ENOBUFS. ON_ERROR_STOP = chyba SQL shodí test
 * se svou zprávou, místo aby se cena hledala ve výstupu, který žádnou nemá.
 */
function psqlVelky(sql: string): string {
  const soubor = join(tmpdir(), `twin-odhad-${process.pid}-${randomUUID()}.sql`);
  writeFileSync(soubor, sql);
  try {
    return execFileSync(
      "psql",
      ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", soubor],
      { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 60000, env: { ...process.env, PGPASSWORD: PG_PASSWORD } },
    );
  } finally {
    unlinkSync(soubor);
  }
}

const dbAvailable = isPgReachable();
const P = `tr${randomUUID().slice(0, 6)}`;
const OP = randomUUID();
const CLEN = randomUUID();
const FA = `${P} Firma A`;
const FB = `${P} Firma B`;

const doc = (sha: string, firma: string, ico: string, superseded: string | null = null) =>
  `('${P}-${sha}', '${P}-d-${sha}', 'invoice', 'transactional', 'AUTO_PASS', ` +
  `'{"owner_company":{"value":"${firma}"},"counterparty_id":{"value":"${P}-${ico}"}}'::jsonb, ` +
  `${superseded ? `'${P}-${superseded}'` : "null"})`;

const FIXTURE = `
INSERT INTO aisha_auth.users (id, email) VALUES ('${OP}', '${P}-op@test.local'), ('${CLEN}', '${P}-clen@test.local')
  ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES ('${OP}', 'admin') ON CONFLICT DO NOTHING;
INSERT INTO public.li_source_registry (source_sha256, doc_slug, doc_type, doc_class, status, fields, superseded_by) VALUES
  ${doc("a1", FA, "ico1")},
  ${doc("a2", FA, "ico2")},
  ${doc("b1", FB, "ico3")};
-- Nahrazená verze dokladu firmy A s IČO 9: osu nesmí propustit.
INSERT INTO public.li_source_registry (source_sha256, doc_slug, doc_type, doc_class, status, fields, superseded_by) VALUES
  ${doc("a0", FA, "ico9", "a1")};
DO $$
DECLARE u1 uuid; u2 uuid; u3 uuid; u4 uuid; u5 uuid; t1 uuid; t2 uuid; t3 uuid; t4 uuid;
        ca uuid; r1 uuid; r2 uuid; r3 uuid;
BEGIN
  INSERT INTO public.twin_entities (entity_type, label) VALUES ('${P}_unit', 'U1') RETURNING id INTO u1;
  INSERT INTO public.twin_entities (entity_type, label) VALUES ('${P}_unit', 'U2') RETURNING id INTO u2;
  INSERT INTO public.twin_entities (entity_type, label) VALUES ('${P}_unit', 'U3') RETURNING id INTO u3;
  INSERT INTO public.twin_entities (entity_type, label) VALUES ('${P}_unit', 'U4') RETURNING id INTO u4;
  INSERT INTO public.twin_entities (entity_type, label) VALUES ('${P}_unit', 'U5') RETURNING id INTO u5;
  INSERT INTO public.twin_events (event_type, twin_id, occurred_at, attrs, source) VALUES
    ('param', u1, now(),                     '{"code":"obsazeno","value":"ano"}', 'test'),
    ('param', u1, now(),                     '{"code":"druh","value":"sklad"}', 'test'),
    ('param', u1, now(),                     '{"code":"pocet","value":"0"}', 'test'),
    -- U2 byla obsazená a uvolnila se: rozhoduje POSLEDNÍ hodnota.
    ('param', u2, now() - interval '2 days', '{"code":"obsazeno","value":"ano"}', 'test'),
    ('param', u2, now(),                     '{"code":"obsazeno","value":"ne"}', 'test'),
    ('param', u2, now(),                     '{"code":"druh","value":"sklad"}', 'test'),
    ('param', u3, now(),                     '{"code":"obsazeno","value":"ne"}', 'test'),
    ('param', u3, now(),                     '{"code":"druh","value":"kancelar"}', 'test'),
    -- U5: tentýž pár dvakrát (import zopakoval událost) — počet párů se nesmí nafouknout.
    ('param', u5, now() - interval '1 day',  '{"code":"obsazeno","value":"ne"}', 'test'),
    ('param', u5, now(),                     '{"code":"obsazeno","value":"ne"}', 'test'),
    ('param', u5, now(),                     '{"code":"druh","value":"sklad"}', 'test');
  -- U4 nemá žádnou událost.

  INSERT INTO public.twin_entities (entity_type, label) VALUES ('${P}_firma', 'T1') RETURNING id INTO t1;
  INSERT INTO public.twin_entities (entity_type, label) VALUES ('${P}_firma', 'T2') RETURNING id INTO t2;
  INSERT INTO public.twin_entities (entity_type, label) VALUES ('${P}_firma', 'T3') RETURNING id INTO t3;
  INSERT INTO public.twin_entities (entity_type, label) VALUES ('${P}_firma', 'T4') RETURNING id INTO t4;
  INSERT INTO public.twin_events (event_type, twin_id, occurred_at, attrs, source) VALUES
    ('param', t1, now(),                     '{"code":"company_ico","value":"${P}-ico1"}', 'test'),
    ('param', t2, now(),                     '{"code":"company_ico","value":"${P}-ico3"}', 'test'),
    ('param', t3, now(),                     '{"code":"company_ico","value":"${P}-ico9"}', 'test'),
    -- T4 mělo IČO 1, dnes má 7: platí poslední hodnota.
    ('param', t4, now() - interval '2 days', '{"code":"company_ico","value":"${P}-ico1"}', 'test'),
    ('param', t4, now(),                     '{"code":"company_ico","value":"${P}-ico7"}', 'test');

  INSERT INTO public.twin_entities (entity_type, label) VALUES ('company', '${FA}') RETURNING id INTO ca;
  INSERT INTO public.twin_external_refs (twin_id, ref_kind, source, source_key, state, proposed_by, confirmed_at)
    VALUES (ca, 'nase_firma', 'money', '${FA}', 'confirmed', 'test', now());
  INSERT INTO public.twin_entities (entity_type, label) VALUES ('${P}_prostor', 'R1') RETURNING id INTO r1;
  INSERT INTO public.twin_entities (entity_type, label) VALUES ('${P}_prostor', 'R2') RETURNING id INTO r2;
  INSERT INTO public.twin_entities (entity_type, label) VALUES ('${P}_prostor', 'R3') RETURNING id INTO r3;
  INSERT INTO public.twin_relations (source_twin_id, target_twin_id, relation_kind, valid_from, valid_to) VALUES
    (r1, ca, '${P}_pronajimatel', now() - interval '1 year', now() + interval '1 year'),
    (r2, ca, '${P}_jiny_druh',    now() - interval '1 year', null),
    (r3, ca, '${P}_pronajimatel', now() + interval '1 day',  null);
END $$;
`;

const U = `"entity_type":"${P}_unit"`;
const NAJEMCI = `"entity_type":"${P}_firma","scope_map":{"owner_company":{"via":"doc_field","param":"company_ico","doc_field":"counterparty_id"}}`;
const PROSTORY = `"entity_type":"${P}_prostor","scope_map":{"owner_company":{"via":"relation","relation_kind":"${P}_pronajimatel","target_ref":"nase_firma"}}`;

const PRIPADY: Array<[string, string]> = [
  ["hp_druh", `{${U},"has_param":"druh"}`],
  ["hp_prazdny", `{${U},"has_param":""}`],
  ["hp_neni", `{${U},"has_param":"neni"}`],
  ["hp_a_eq", `{${U},"has_param":"druh","param_eq":{"obsazeno":"ne"}}`],
  ["eq_ne", `{${U},"param_eq":{"obsazeno":"ne"}}`],
  ["eq_ano", `{${U},"param_eq":{"obsazeno":"ano"}}`],
  ["eq_2_pary", `{${U},"param_eq":{"obsazeno":"ne","druh":"sklad"}}`],
  ["eq_chybi_kod", `{${U},"param_eq":{"obsazeno":"ne","neexistuje":"x"}}`],
  ["eq_prazdny", `{${U},"param_eq":{}}`],
  ["eq_null", `{${U},"param_eq":{"obsazeno":null}}`],
  ["eq_pole", `{${U},"param_eq":["obsazeno"]}`],
  ["eq_retezec", `{${U},"param_eq":"ne"}`],
  ["eq_cislo", `{${U},"param_eq":{"pocet":0}}`],
  ["doc_a", `{${NAJEMCI},"owner_company":"${FA}"}`],
  ["doc_b", `{${NAJEMCI},"owner_company":"${FB}"}`],
  ["doc_nikdo", `{${NAJEMCI},"owner_company":"${P} nikdo"}`],
  ["doc_bez_firmy", `{${NAJEMCI}}`],
  ["doc_prazdna_firma", `{${NAJEMCI},"owner_company":""}`],
  ["rel_a", `{${PROSTORY},"owner_company":"${FA}"}`],
  ["rel_bez_firmy", `{${PROSTORY}}`],
];

const rows = (params: string) =>
  `(SELECT coalesce(string_agg(r->>'label', ',' ORDER BY r->>'label'), '') FROM jsonb_array_elements(public.get_twin_register('${params}'::jsonb)->'data'->'rows') r)`;

function probe(): string {
  const dotazy = (kdo: string) => PRIPADY.map(([n, p]) => `SELECT '${kdo}:${n}=' || ${rows(p)} AS out;`).join("\n");
  return psqlMultiline(`
BEGIN;
${FIXTURE}
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"${OP}","role":"authenticated"}', true);
${dotazy("s")}
SELECT set_config('request.jwt.claims', '{"sub":"${CLEN}","role":"authenticated"}', true);
${dotazy("c")}
RESET ROLE;
ROLLBACK;
`);
}

/** Počty řádků z produkce 2026-09-30 — odhad plánu se dělá z nich, ne z malé testovací DB. */
const PROFIL: Array<[string, number]> = [
  ["public.twin_entities", 3993],
  ["public.twin_events", 790],
  ["public.li_source_registry", 65742],
];

/** Stará (kolo 12) korelovaná podoba ramene doc_field — mutace pro důkaz, že měřítko rozlišuje. */
function mutaceDocField(telo: string): string {
  const a = telo.replace(
    /t\.id in \(\s*select lf\.twin_id from latest lf\s*where lf\.code = \(select param from cfg\)/,
    "exists (select 1 from latest lf where lf.twin_id = t.id and lf.code = (select param from cfg)",
  );
  return a.replace(
    /lf\.val in \(select h\.val from doc_hodnoty h\)/,
    "lf.val in (select d.fields->(select doc_field from cfg)->>'value' from public.li_source_registry d " +
      "where d.superseded_by is null and d.fields->'owner_company'->>'value' = (select firma from cfg))",
  );
}

function odhady(): { prah: number; profil: number; nyni: number; mutace: number; zmeneno: boolean } {
  const zdroj = psqlQuery(`SELECT prosrc FROM pg_proc WHERE oid = 'public.get_twin_register(jsonb)'::regprocedure`);
  // SQL funkce v PG 17 plánuje tělo s parametrem jako Param (generický plán) — totéž dělá PREPARE.
  const telo = zdroj.replace(/\bp_params\b/g, "$1").replace(/;\s*$/, "");
  const mut = mutaceDocField(telo);
  const params = `'{${NAJEMCI},"has_param":"company_ico","owner_company":"${FA}"}'::jsonb`;
  const out = psqlVelky(`
BEGIN;
${FIXTURE}
UPDATE pg_class c
   SET relpages = greatest(1, (pg_relation_size(c.oid) / current_setting('block_size')::int)::int), reltuples = x.n
  FROM (VALUES ${PROFIL.map(([t, n]) => `('${t}'::regclass, ${n})`).join(", ")}) x(oid, n)
 WHERE c.oid = x.oid;
SELECT 'profil=' || count(*) FROM pg_class c WHERE c.oid IN (${PROFIL.map(([t]) => `'${t}'::regclass`).join(", ")})
   AND c.reltuples IN (${PROFIL.map(([, n]) => n).join(", ")});
SELECT 'prah=' || current_setting('jit_above_cost');
SET LOCAL plan_cache_mode = force_generic_plan;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"${OP}","role":"authenticated"}', true);
PREPARE nyni(jsonb) AS ${telo};
PREPARE mutace(jsonb) AS ${mut};
\\echo @@nyni
EXPLAIN (FORMAT JSON) EXECUTE nyni(${params});
\\echo @@mutace
EXPLAIN (FORMAT JSON) EXECUTE mutace(${params});
RESET ROLE;
ROLLBACK;
`);
  const cena = (znacka: string) => {
    const m = new RegExp(`@@${znacka}[\\s\\S]*?"Total Cost":\\s*([0-9.]+)`).exec(out);
    return m ? Number(m[1]) : NaN;
  };
  return {
    prah: Number(/prah=([0-9.]+)/.exec(out)?.[1]),
    profil: Number(/profil=(\d+)/.exec(out)?.[1]),
    nyni: cena("nyni"),
    mutace: cena("mutace"),
    zmeneno: mut !== telo && mut.includes("lf.twin_id = t.id") && mut.includes("from public.li_source_registry d"),
  };
}

describe("registr twinů: filtry bloku a odhad plánu", () => {
  beforeAll(() => reportTestCapabilities("registr twinů — filtry"));

  it.skipIf(!dbAvailable)("filtry vrací totéž co záměr — správce vidí, člen bez rozsahu nic", () => {
    const out = probe();
    const exp = (k: string, v: string) => expect(out, k).toContain(`s:${k}=${v}\n`);
    // 1. has_param
    exp("hp_druh", "U1,U2,U3,U5");
    exp("hp_prazdny", "U1,U2,U3,U4,U5");
    exp("hp_neni", "");
    exp("hp_a_eq", "U2,U3,U5");
    // 2. param_eq
    exp("eq_ne", "U2,U3,U5");
    exp("eq_ano", "U1");
    exp("eq_2_pary", "U2,U5");
    exp("eq_chybi_kod", "");
    exp("eq_prazdny", "U1,U2,U3,U4,U5");
    exp("eq_null", "");
    exp("eq_pole", "U1,U2,U3,U4,U5");
    exp("eq_retezec", "U1,U2,U3,U4,U5");
    exp("eq_cislo", "U1");
    // 3. doc_field: T3 jen v nahrazeném dokladu, T4 má IČO 1 jen historicky
    exp("doc_a", "T1");
    exp("doc_b", "T2");
    exp("doc_nikdo", "");
    exp("doc_bez_firmy", "T1,T2,T3,T4");
    exp("doc_prazdna_firma", "T1,T2,T3,T4");
    // 4. relation: R2 jiný druh vazby, R3 platí až od zítřka
    exp("rel_a", "R1");
    exp("rel_bez_firmy", "R1,R2,R3");
    // 5. člen bez rozsahu: nic, v žádném případu
    for (const [n] of PRIPADY) expect(out, `člen ${n}`).toContain(`c:${n}=\n`);
  });

  it.skipIf(!dbAvailable)("odhad při počtech z produkce je pod jit_above_cost; stará korelovaná podoba nad ním", () => {
    const o = odhady();
    console.log(`[registr twinů] odhad nyní ${o.nyni}, stará podoba ${o.mutace}, práh JIT ${o.prah}`);
    expect(o.profil, "profil počtů se do pg_class nepropsal — měřítko by měřilo malou DB").toBe(PROFIL.length);
    expect(o.zmeneno, "mutace se neaplikovala — tělo funkce se změnilo, uprav mutaceDocField").toBe(true);
    expect(Number.isFinite(o.nyni) && Number.isFinite(o.mutace), "EXPLAIN nevrátil cenu").toBe(true);
    expect(o.nyni, "tělo get_twin_register dostane JIT — odhad je nafouknutý").toBeLessThan(o.prah);
    expect(o.mutace, "měřítko nerozliší korelovanou EXISTS pod OR — profil počtů nestačí").toBeGreaterThan(o.prah);
  });
});
