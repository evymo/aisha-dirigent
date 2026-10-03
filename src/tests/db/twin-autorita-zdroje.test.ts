import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline, psqlQuery } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * Autorita zdroje u aditivních veličin (2026-09-26, dohoda vozový park × RIQi).
 *
 * ⛔ PROČ: jízdu může hlásit víc dodavatelů (T-cars, Webdispečink, Eurowag).
 * Čtečka veličin (`twin_param_values`) do té doby sčítala všechny události
 * daného typu — „ujeto" by se u vozidla s dvěma jednotkami sečetlo dvakrát.
 * Sloupec `source` katalogu se přitom počítal (cat_source) a nepoužil.
 *
 * Měří se nad skutečnou DB:
 *   • součtová veličina počítá jen zdroj z katalogu a jeho dráhu
 *     ('<zdroj>:…'), ne slug, který jen začíná stejně;
 *   • veličina se stavem ('last') zůstává vícezdrojová;
 *   • součtová veličina bez deklarované autority se nefiltruje;
 *   • nálezy: katalog jmenuje neexistující zdroj = 'nezname' (vada dat),
 *     zdroj existuje, ale nic nezapsal = 'bez_dat' (informace).
 */
const dbAvailable = isPgReachable();
const HEADER = "\\set ON_ERROR_STOP on\n";
const VUZ = "55555555-5555-4555-8555-5555555555a1";
const BEZNY = "55555555-5555-4555-8555-555555555502";
const TYP = "zz_autorita_vuz";

const sluzba = (sql: string) =>
  psqlQuery(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true) IS NOT NULL AND true; ${sql}`)
    .trim()
    .split("\n")
    .pop() ?? "";

const zkusJako = (sub: string, sql: string): string => {
  try {
    psqlMultiline(`${HEADER}BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"${sub}"}', true);
${sql};
ROLLBACK;`);
    return "PROSLO";
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    return String(e.stderr ?? e.message ?? err);
  }
};

beforeAll(async () => {
  await reportTestCapabilities("autorita zdroje");
  if (!dbAvailable) return;
  psqlMultiline(`${HEADER}
DELETE FROM public.twin_entities WHERE id = '${VUZ}';
DELETE FROM public.twin_parameter_definitions WHERE code LIKE 'zz_aut_%';
DELETE FROM public.twin_external_refs WHERE source = 'zz-dodavatel-c';
INSERT INTO aisha_auth.users (id, email) VALUES ('${BEZNY}', 'autorita-bezny@test.local') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (user_id, email) VALUES ('${BEZNY}', 'autorita-bezny@test.local') ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.twin_entities (id, entity_type, label) VALUES ('${VUZ}', '${TYP}', 'zz vůz');

INSERT INTO public.twin_parameter_definitions
  (code, name, entity_type, data_type, unit, source, aggregation, historization, metadata) VALUES
  -- součet s autoritou dodavatele A
  ('zz_aut_ujeto',   'Ujeto',    '${TYP}', 'decimal', 'km', 'zz-dodavatel-a', 'sum',  'event_log',
   '{"event_type":"zz_aut_jizda","attr":"km"}'::jsonb),
  -- stav: vícezdrojový
  ('zz_aut_hladina', 'Hladina',  '${TYP}', 'decimal', 'l',  'zz-dodavatel-a', 'last', 'timeseries',
   '{"event_type":"zz_aut_stav","attr":"l"}'::jsonb),
  -- součet BEZ deklarované autority: nefiltruje se (není z čeho vybrat)
  ('zz_aut_volne',   'Volně',    '${TYP}', 'decimal', 'km', NULL,             'sum',  'event_log',
   '{"event_type":"zz_aut_jizda","attr":"km"}'::jsonb),
  -- překlep ve jménu zdroje: nikdo takový neexistuje
  ('zz_aut_preklep', 'Překlep',  '${TYP}', 'decimal', 'km', 'zz-dodavatel-aa-preklep', 'sum', 'event_log',
   '{"event_type":"zz_aut_jizda","attr":"km"}'::jsonb),
  -- zdroj existuje (má reference), ale událost toho typu zatím nezapsal
  ('zz_aut_ceka',    'Čeká',     '${TYP}', 'decimal', 'l',  'zz-dodavatel-c', 'sum',  'event_log',
   '{"event_type":"zz_aut_tankovani","attr":"l"}'::jsonb);

INSERT INTO public.twin_external_refs (twin_id, source, source_key, ref_kind, state, proposed_by)
VALUES ('${VUZ}', 'zz-dodavatel-c', 'c-1', 'primary_id', 'proposed', 'test');

-- Tatáž jízda od dvou dodavatelů + slug, který jen ZAČÍNÁ stejně.
INSERT INTO public.twin_events (event_type, twin_id, occurred_at, attrs, source, source_ref) VALUES
  ('zz_aut_jizda', '${VUZ}', now() - interval '2 hours', '{"km":"10"}', 'zz-dodavatel-a:trip', 'a-1'),
  ('zz_aut_jizda', '${VUZ}', now() - interval '2 hours', '{"km":"10"}', 'zz-dodavatel-b',      'b-1'),
  ('zz_aut_jizda', '${VUZ}', now() - interval '1 hours', '{"km":"5"}',  'zz-dodavatel-a-x',    'ax-1'),
  ('zz_aut_stav',  '${VUZ}', now() - interval '3 hours', '{"l":"50"}',  'zz-dodavatel-a',      's-a'),
  ('zz_aut_stav',  '${VUZ}', now() - interval '1 hours', '{"l":"40"}',  'zz-dodavatel-b',      's-b');`);
});

describe.skipIf(!dbAvailable)("autorita zdroje u aditivních veličin", () => {
  it("součet počítá jen zdroj z katalogu a jeho dráhu — ne druhého dodavatele ani podobný slug", () => {
    const r = sluzba(`SELECT value::text || '|' || sources
                        FROM public.twin_param_agg('zz_aut_ujeto', 'sum', now() - interval '1 day', NULL, '${TYP}')
                       WHERE twin_id = '${VUZ}';`);
    expect(r).toBe("10|zz-dodavatel-a:trip");
  });

  it("veličina se stavem zůstává vícezdrojová: vyhraje poslední hodnota", () => {
    expect(sluzba(`SELECT count(*) FROM public.twin_param_values('zz_aut_hladina') WHERE twin_id = '${VUZ}';`)).toBe("2");
    expect(
      sluzba(`SELECT value::text FROM public.twin_param_agg('zz_aut_hladina', 'last', NULL, NULL, '${TYP}')
               WHERE twin_id = '${VUZ}';`),
    ).toBe("40");
  });

  it("součet bez deklarované autority se nefiltruje", () => {
    expect(
      sluzba(`SELECT value::text FROM public.twin_param_agg('zz_aut_volne', 'sum', now() - interval '1 day', NULL, '${TYP}')
               WHERE twin_id = '${VUZ}';`),
    ).toBe("25");
  });

  it("nálezy říkají nahlas, proč je veličina NEMĚŘENO — vada dat a informace zvlášť", () => {
    const nalezy = (JSON.parse(sluzba(`SELECT public.twin_catalog_source_findings()::text;`)) as Array<{
      code: string;
      source: string;
      trida: string;
    }>).filter((n) => n.code.startsWith("zz_aut_"));

    expect(nalezy).toEqual([
      { code: "zz_aut_preklep", source: "zz-dodavatel-aa-preklep", trida: "nezname" },
      { code: "zz_aut_ceka", source: "zz-dodavatel-c", trida: "bez_dat" },
    ]);
  });

  it("nálezy jsou pro správu, ne pro běžného uživatele", () => {
    expect(zkusJako(BEZNY, "SELECT public.twin_catalog_source_findings()")).toMatch(/admin\/staff required/);
  });
});
