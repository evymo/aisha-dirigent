/**
 * Kontrakt os pohledu (ADR-003 K5): volby se ODVOZUJÍ z dat nad šesti druhy
 * substrátu, osy jsou ŘÁDKY pod RLS a sekce dostane jen ty svoje — už s volbami.
 *
 * ⛔ NAMĚŘENO 2026-09-06: seznam os byl konstantou v generickém klientovi a nesl
 * jména věcí jedné instance (`owner_company`, `unit_site`). Osy, které model
 * jmenuje — druh entity, vazba, skupina, rodina šablon — se z dat odvodit vůbec
 * nedaly, takže přepínač uměl mluvit jen o dokladech a jednotkách.
 *
 * CO SE MĚŘÍ:
 *   1. čtyři nové druhy substrátu vrátí volby s POČTY (počet je informace: „osob
 *      812" a „firem 9" je pro volbu pohledu rozdíl);
 *   2. `get_surface_scope_axes` vydá jen osy DANÉ SEKCE, seřazené, a osu bez
 *      voleb zamlčí (přepínač nesmí nabízet prázdno);
 *   3. RLS: cizí bez role nevidí ŽÁDNOU osu, i když řádky existují;
 *   4. osa skutečně filtruje — hodnota z osy projde blokem registru až do řádků
 *      (jinak by osa jen zdobila lištu).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

const dbAvailable = isPgReachable();

const OP = "c5000000-1111-4000-8000-0000000000b1";
const SUBJ = "c5000000-2222-4000-8000-0000000000b2";
const OUT = "c5000000-3333-4000-8000-0000000000b3";

function asUser(sub: string): string {
  return `SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"${sub}","role":"authenticated"}', true);`;
}

/** Účty, role, dvě entity s vazbou, štítek a osy — vše jako superuser: role
 *  `authenticated` do jádrových tabulek nepíše a fixtura není předmětem měření. */
const FIXTURE = `
INSERT INTO aisha_auth.users (id, email) VALUES
  ('${OP}', 'sx-op@test.local'), ('${SUBJ}', 'sx-subj@test.local'), ('${OUT}', 'sx-out@test.local')
ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (user_id, email, display_name) VALUES
  ('${OP}', 'sx-op@test.local', 'Operator'), ('${SUBJ}', 'sx-subj@test.local', 'Subject'), ('${OUT}', 'sx-out@test.local', 'Outsider')
ON CONFLICT (user_id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES ('${OP}', 'admin') ON CONFLICT DO NOTHING;
DO $$
DECLARE v_osoba uuid; v_centrum uuid;
BEGIN
  INSERT INTO public.twin_entities (entity_type, label) VALUES ('sx_osoba', 'Subject') RETURNING id INTO v_osoba;
  INSERT INTO public.twin_entities (entity_type, label) VALUES ('sx_centrum', 'Centrum Praha') RETURNING id INTO v_centrum;
  INSERT INTO public.twin_relations (source_twin_id, target_twin_id, relation_kind)
    VALUES (v_osoba, v_centrum, 'sx_clen');
  INSERT INTO public.story_labels (label, color, resource_type, resource_id)
    VALUES ('sx_zajemce', 'gray', 'actor', '${SUBJ}');
END $$;
INSERT INTO public.surface_scope_axes (axis_key, title_key, dim, params, surfaces, audience, namespace, position, is_active) VALUES
  ('sx.druh',    'k.druh',    'entity_type', '{"source":"twin_kind"}'::jsonb,               '["sx_sekce"]'::jsonb, '{"roles":["admin","staff"]}'::jsonb, 'sx_test', 0, true),
  ('sx.vazba',   'k.vazba',   'vazba',       '{"source":"relation"}'::jsonb,                '["sx_sekce"]'::jsonb, '{"roles":["admin","staff"]}'::jsonb, 'sx_test', 1, true),
  ('sx.skupina', 'k.skupina', 'skupina',     '{"source":"label","key":"actor"}'::jsonb,     '["sx_sekce"]'::jsonb, '{"roles":["admin","staff"]}'::jsonb, 'sx_test', 2, true),
  ('sx.jinde',   'k.jinde',   'entity_type', '{"source":"twin_kind"}'::jsonb,               '["sx_jina"]'::jsonb,  '{"roles":["admin","staff"]}'::jsonb, 'sx_test', 3, true),
  ('sx.prazdna', 'k.prazdna', 'nic',         '{"source":"label","key":"nikdy_nic"}'::jsonb, '["sx_sekce"]'::jsonb, '{"roles":["admin","staff"]}'::jsonb, 'sx_test', 4, true),
  ('sx.vypnuta', 'k.vypnuta', 'entity_type', '{"source":"twin_kind"}'::jsonb,               '["sx_sekce"]'::jsonb, '{"roles":["admin","staff"]}'::jsonb, 'sx_test', 5, false);
`;

function probe(): string {
  return psqlMultiline(`
BEGIN;
${FIXTURE}
${asUser(OP)}
-- 1. nové druhy substrátu: volby s počty
SELECT 'kind=' || ((d->'data'->'options') @> '[{"value":"sx_centrum","count":1}]'::jsonb)::text || '/' ||
       ((d->'data'->'options') @> '[{"value":"sx_osoba","count":1}]'::jsonb)::text AS out
FROM public.get_scope_options('{"source":"twin_kind"}'::jsonb) d;
SELECT 'rel=' || ((d->'data'->'options') @> '[{"value":"sx_clen","count":1}]'::jsonb)::text AS out
FROM public.get_scope_options('{"source":"relation"}'::jsonb) d;
SELECT 'label=' || ((d->'data'->'options') @> '[{"value":"sx_zajemce","count":1}]'::jsonb)::text AS out
FROM public.get_scope_options('{"source":"label","key":"actor"}'::jsonb) d;
SELECT 'tmpl=' || (jsonb_typeof(d->'data'->'options'))::text || '/' || (d->'provenance'->>'trace_id') AS out
FROM public.get_scope_options('{"source":"template"}'::jsonb) d;

-- 2. osy sekce: jen svoje, seřazené, prázdná zamlčená, vypnutá neviditelná
SELECT 'axes=' || (SELECT string_agg(a->>'axis_key', ',' ORDER BY ord)
                   FROM jsonb_array_elements(d->'data'->'axes') WITH ORDINALITY t(a, ord)) AS out
FROM public.get_surface_scope_axes('{"surface":"sx_sekce"}'::jsonb) d;
SELECT 'axes_dim=' || (SELECT string_agg(a->>'dim', ',' ORDER BY ord)
                       FROM jsonb_array_elements(d->'data'->'axes') WITH ORDINALITY t(a, ord)) AS out
FROM public.get_surface_scope_axes('{"surface":"sx_sekce"}'::jsonb) d;
SELECT 'axes_jina=' || (SELECT string_agg(a->>'axis_key', ',') FROM jsonb_array_elements(d->'data'->'axes') a) AS out
FROM public.get_surface_scope_axes('{"surface":"sx_jina"}'::jsonb) d;

-- 3. osa SKUTEČNĚ filtruje. Registr má druhy vazeb jako pole, takže rovnost
-- by nenašla nic; deklarovaný operátor 'contains' se ptá na PRVEK. Bez něj by
-- osa šla nabídnout, ale nešlo by podle ní vybrat — ozdoba na liště.
SELECT 'filtr_contains=' || jsonb_array_length(d->'data'->'rows') AS out
FROM public.get_audience_view_table_block(jsonb_build_object(
  'view', 'audience_admin_twin_directory_v', 'limit', 50,
  'columns', jsonb_build_array(jsonb_build_object('key','label','label_key','k.l','src','label')),
  'filters', jsonb_build_array(jsonb_build_object('src','relation_kinds','param','vazba','op','contains')),
  'vazba', 'sx_clen')) d;
SELECT 'filtr_mimo=' || jsonb_array_length(d->'data'->'rows') AS out
FROM public.get_audience_view_table_block(jsonb_build_object(
  'view', 'audience_admin_twin_directory_v', 'limit', 50,
  'columns', jsonb_build_array(jsonb_build_object('key','label','label_key','k.l','src','label')),
  'filters', jsonb_build_array(jsonb_build_object('src','relation_kinds','param','vazba','op','contains')),
  'vazba', 'sx_neexistujici_vazba')) d;
SELECT 'filtr_eq_druh=' || jsonb_array_length(d->'data'->'rows') AS out
FROM public.get_audience_view_table_block(jsonb_build_object(
  'view', 'audience_admin_twin_directory_v', 'limit', 50,
  'columns', jsonb_build_array(jsonb_build_object('key','label','label_key','k.l','src','label')),
  'filters', jsonb_build_array(jsonb_build_object('src','entity_type','param','entity_type')),
  'entity_type', 'sx_centrum')) d;
RESET ROLE;
ROLLBACK;
`);
}

function denyProbe(): string {
  return psqlMultiline(`
BEGIN;
${FIXTURE}
${asUser(OUT)}
SELECT 'outsider_axes=' || jsonb_array_length(d->'data'->'axes') AS out
FROM public.get_surface_scope_axes('{"surface":"sx_sekce"}'::jsonb) d;
SELECT 'outsider_rows=' || count(*) AS out FROM public.surface_scope_axes;
RESET ROLE;
ROLLBACK;
`);
}

describe("osy pohledu (K5): substráty, deklarace, RLS", () => {
  beforeAll(() => reportTestCapabilities("scope axes contract"));

  it.skipIf(!dbAvailable)("nové druhy substrátu vydají volby s počty; sekce dostane jen své osy", () => {
    const out = probe();
    expect(out, "druh entity se odvozuje z twin_entities").toContain("kind=true/true");
    expect(out, "vazba se odvozuje z platných twin_relations").toContain("rel=true");
    expect(out, "skupina se odvozuje ze story_labels nad druhem zdroje").toContain("label=true");
    expect(out, "rodina šablon má vlastní stopu v provenienci").toContain("tmpl=array/scope-options:template");
    // Pořadí podle `position`; `sx.prazdna` (štítek, který nikdo nemá) se nevydá,
    // `sx.vypnuta` neprojde RLS, `sx.jinde` patří jiné sekci.
    expect(out).toContain("axes=sx.druh,sx.vazba,sx.skupina");
    expect(out).toContain("axes_dim=entity_type,vazba,skupina");
    expect(out, "osa jiné sekce se sem nesmí připlést").toContain("axes_jina=sx.jinde");
    // Osa musí filtrovat, ne jen zdobit: jedna entita má vazbu `sx_clen`,
    // na neexistující vazbu nesmí padnout nic, a rovnost dál platí pro druh.
    expect(out, "operátor contains hledá PRVEK pole druhů vazeb").toContain("filtr_contains=1");
    expect(out, "filtr, který nic nevyloučí, není filtr").toContain("filtr_mimo=0");
    expect(out, "rovnost (výchozí operátor) zůstává v platnosti").toContain("filtr_eq_druh=1");
  });

  it.skipIf(!dbAvailable)("bez role nevidí volající žádnou osu ani řádek", () => {
    const out = denyProbe();
    expect(out).toContain("outsider_axes=0");
    expect(out, "RLS drží i samotné řádky, ne jen RPC").toContain("outsider_rows=0");
  });
});
