/**
 * OVLADAČE BLOKŮ: deklarace klientských parametrů jako DATA bloku → shell je nabídne.
 *
 * Náčrtek majitele 2026-09-29 („Smlouvy a nájmy“): kniha faktur za měsíc, „jen nad rok“
 * u pohledávek, hledání podle jména, volné jednotky. Server k tomu potřebuje tři věci:
 *   1. surface_client_params_filter přijme OBJEKTOVOU deklaraci (typ + popis pro UI)
 *      a výběr více hodnot z výčtu; řetězcová deklarace platí beze změny;
 *   2. get_surface_layout_ui vydá JEN deklarativní klíče bloků sekce (nikdy zbytek
 *      konfigurace) a bloky bez deklarace vynechá;
 *   3. get_twin_register umí `param_eq` — rovnost POSLEDNÍ hodnoty parametru.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "crypto";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

const dbAvailable = isPgReachable();
const P = `ob${randomUUID().slice(0, 6)}`;
const OP = randomUUID();

const SPEC = `'{"client_params":{
  "mesic":{"type":"date","ui":"month","label_key":"k.m"},
  "min_days":{"type":"int","ui":"toggle","on":365},
  "tridy":{"enum":["N","E","P"],"multi":true},
  "druh":{"enum":["a","b"]},
  "q":"text"}}'::jsonb`;
const f = (client: string) => `public.surface_client_params_filter(${SPEC}, '${client}'::jsonb)::text`;

const FIXTURE = `
INSERT INTO aisha_auth.users (id, email) VALUES ('${OP}', '${P}-op@test.local') ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES ('${OP}', 'admin') ON CONFLICT DO NOTHING;
-- Registr datových RPC plní na živé DB data instance; tady ho fixtura doplní sama (v transakci).
INSERT INTO public.surface_data_rpcs (rpc_name, description, is_active) VALUES ('get_twin_register', 'test', true)
  ON CONFLICT (rpc_name) DO NOTHING;
INSERT INTO public.surface_blocks (block_slug, block_type, title_key, source_rpc, source_params, namespace, sensitivity, is_active) VALUES
  ('${P}_kniha', 'table', 'k.t', 'get_twin_register',
   '{"entity_type":"x","tajne":"nesmi-ven","client_params":{"mesic":{"type":"date","ui":"month"}},"default_sort":{"key":"label","dir":1},"search":true}'::jsonb,
   '${P}', 'internal', true),
  ('${P}_holy', 'table', 'k.t', 'get_twin_register', '{"entity_type":"x"}'::jsonb, '${P}', 'internal', true);
INSERT INTO public.surface_layouts (surface, block_id, position, audience, is_active)
  SELECT '${P}_sekce', id, row_number() over (order by block_slug), '{}'::jsonb, true FROM public.surface_blocks WHERE namespace = '${P}';
DO $$
DECLARE u1 uuid; u2 uuid; u3 uuid;
BEGIN
  INSERT INTO public.twin_entities (entity_type, label) VALUES ('${P}_unit', 'U1') RETURNING id INTO u1;
  INSERT INTO public.twin_entities (entity_type, label) VALUES ('${P}_unit', 'U2') RETURNING id INTO u2;
  INSERT INTO public.twin_entities (entity_type, label) VALUES ('${P}_unit', 'U3') RETURNING id INTO u3;
  -- U2 byla obsazená a uvolnila se: rozhoduje POSLEDNÍ hodnota, ne kterákoli.
  INSERT INTO public.twin_events (event_type, twin_id, occurred_at, attrs, source) VALUES
    ('param', u1, now(),                    '{"code":"obsazeno","value":"ano"}', 'test'),
    ('param', u2, now() - interval '2 days','{"code":"obsazeno","value":"ano"}', 'test'),
    ('param', u2, now(),                    '{"code":"obsazeno","value":"ne"}',  'test'),
    ('param', u3, now(),                    '{"code":"obsazeno","value":"ne"}',  'test');
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"${OP}","role":"authenticated"}', true);
`;

const rows = (params: string) =>
  `(SELECT coalesce(string_agg(r->>'label', ',' ORDER BY r->>'label'), '') FROM jsonb_array_elements(public.get_twin_register(${params})->'data'->'rows') r)`;

function probe(): string {
  return psqlMultiline(`
BEGIN;
${FIXTURE}
-- 1. objektová deklarace
SELECT 'mesic_ok=' || ${f('{"mesic":"2026-08-01"}')} AS out;
SELECT 'mesic_spatne=' || ${f('{"mesic":"srpen"}')} AS out;
SELECT 'toggle=' || ${f('{"min_days":365}')} AS out;
SELECT 'multi_ok=' || ${f('{"tridy":["N","E"]}')} AS out;
SELECT 'multi_cizi=' || ${f('{"tridy":["N","X"]}')} AS out;
SELECT 'multi_prazdne=' || ${f('{"tridy":[]}')} AS out;
SELECT 'multi_retezec=' || ${f('{"tridy":"N"}')} AS out;
SELECT 'enum_jeden=' || ${f('{"druh":"a"}')} AS out;
SELECT 'retezcovy_typ=' || ${f('{"q":"Hana"}')} AS out;
SELECT 'nedeklarovany=' || ${f('{"cizi":"x"}')} AS out;
-- 2. UI metadata sekce
SELECT 'ui_bloky=' || (SELECT string_agg(k, ',') FROM jsonb_object_keys(public.get_surface_layout_ui('${P}_sekce')->'blocks') k) AS out;
SELECT 'ui_klice=' || (SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(public.get_surface_layout_ui('${P}_sekce')->'blocks'->'${P}_kniha') k) AS out;
SELECT 'ui_bez_tajneho=' || (public.get_surface_layout_ui('${P}_sekce')::text NOT LIKE '%nesmi-ven%')::text AS out;
SELECT 'ui_cizi_sekce=' || (public.get_surface_layout_ui('${P}_neni')->'blocks')::text AS out;
-- 3. param_eq
SELECT 'volne=' || ${rows(`'{"entity_type":"${P}_unit","param_eq":{"obsazeno":"ne"}}'::jsonb`)} AS out;
SELECT 'obsazene=' || ${rows(`'{"entity_type":"${P}_unit","param_eq":{"obsazeno":"ano"}}'::jsonb`)} AS out;
SELECT 'bez_filtru=' || ${rows(`'{"entity_type":"${P}_unit"}'::jsonb`)} AS out;
RESET ROLE;
ROLLBACK;
`);
}

describe("ovladače bloků: deklarace → shell, param_eq", () => {
  beforeAll(() => reportTestCapabilities("ovladače bloků"));

  it.skipIf(!dbAvailable)("objektová deklarace, UI metadata a rovnost parametru", () => {
    const out = probe();
    expect(out).toContain('mesic_ok={"mesic": "2026-08-01"}');
    expect(out, "měsíc je datum, ne slovo").toContain("mesic_spatne={}");
    expect(out).toContain('toggle={"min_days": 365}');
    expect(out).toContain('multi_ok={"tridy": ["N", "E"]}');
    expect(out, "hodnota mimo výčet shodí celý výběr").toContain("multi_cizi={}");
    expect(out, "prázdný výběr = parametr se neposílá").toContain("multi_prazdne={}");
    expect(out, "multi chce pole").toContain("multi_retezec={}");
    expect(out).toContain('enum_jeden={"druh": "a"}');
    expect(out, "řetězcová deklarace platí beze změny").toContain('retezcovy_typ={"q": "Hana"}');
    expect(out).toContain("nedeklarovany={}");
    expect(out, "blok bez deklarace se nevydává").toContain(`ui_bloky=${P}_kniha\n`);
    expect(out).toContain("ui_klice=client_params,default_sort,search");
    expect(out, "zbytek konfigurace nesmí ven").toContain("ui_bez_tajneho=true");
    expect(out).toContain("ui_cizi_sekce={}");
    expect(out, "rozhoduje POSLEDNÍ hodnota").toContain("volne=U2,U3");
    expect(out).toContain("obsazene=U1\n");
    expect(out).toContain("bez_filtru=U1,U2,U3");
  });
});
