import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline, psqlQuery } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * Obecné jádro projekce událostí zdrojů na dvojčata (2026-09-27).
 *
 * Jízdy, tankování i tachograf jsou tentýž tvar: kdo (subjekt), s kým (druhá
 * strana), kdy, co. Měří se nad skutečnou DB:
 *   • resolve jen potvrzené vazby K ČASU UDÁLOSTI — čip předaný jinému vozidlu
 *     přiřadí starší událost předchozímu držiteli;
 *   • DRUH ENTITY je druhá pojistka: vazba identity je jedinečná bez druhu
 *     entity, takže klíč vedoucí na dvojče jiného druhu se nezapíše (subjekt)
 *     nebo vynechá (druhá strana) — a spočítá (nalezeno u T-cars 27. 9.);
 *   • nerozřešené a neplatné se jen spočítají, zápis jen nového a změněného;
 *   • nárok jen služba.
 */
const dbAvailable = isPgReachable();
const HEADER = "\\set ON_ERROR_STOP on\n";
const VA = "44444444-4444-4444-8444-4444444444a1";
const VB = "44444444-4444-4444-8444-4444444444a2";
const RD = "44444444-4444-4444-8444-4444444444b1";
const ADMIN = "44444444-4444-4444-8444-444444444401";
const ZDROJ = "zz-jadro-zdroj";

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

/**
 * Jedna kotva času pro celý soubor: `now()` se v každé transakci liší, takže
 * druhé volání by vidělo jiné časy událostí a hlásilo změnu, která není.
 */
const KOTVA = new Date().toISOString();
const cas = (dny: number) => `('${KOTVA}'::timestamptz - interval '${dny} days')`;

/** Dávka řádků jádra — čas se počítá v DB, ať test nezávisí na hodinách procesu. */
const DAVKA = `jsonb_build_array(
  jsonb_build_object('event_type','zz_jizda','lane','jizda','source_ref','r1',
    'subject', jsonb_build_object('key','vuz:1','entity_type','vehicle'),
    'related', jsonb_build_object('key','osoba:1','entity_type','driver'),
    'occurred_at', ${cas(1)}, 'attrs', jsonb_build_object('km', 10)),
  jsonb_build_object('event_type','zz_jizda','lane','jizda','source_ref','r2',
    'subject', jsonb_build_object('key','cip:X','ref_kind','field_identity','entity_type','vehicle'),
    'occurred_at', ${cas(7)}, 'attrs', jsonb_build_object('km', 20)),
  jsonb_build_object('event_type','zz_jizda','lane','jizda','source_ref','r3',
    'subject', jsonb_build_object('key','cip:X','ref_kind','field_identity','entity_type','vehicle'),
    'occurred_at', ${cas(1)}, 'attrs', jsonb_build_object('km', 30)),
  jsonb_build_object('event_type','zz_jizda','lane','jizda','source_ref','r4',
    'subject', jsonb_build_object('key','zamena:1','entity_type','vehicle'),
    'occurred_at', ${cas(1)}, 'attrs', jsonb_build_object('km', 40)),
  jsonb_build_object('event_type','zz_jizda','lane','jizda','source_ref','r5',
    'subject', jsonb_build_object('key','vuz:1','entity_type','vehicle'),
    'related', jsonb_build_object('key','vuz:1','entity_type','driver'),
    'occurred_at', ${cas(2)}, 'attrs', jsonb_build_object('km', 50)),
  jsonb_build_object('event_type','zz_jizda','lane','jizda','source_ref','r6',
    'subject', jsonb_build_object('key','neznamy:1','entity_type','vehicle'),
    'occurred_at', ${cas(1)}),
  jsonb_build_object('event_type','zz_jizda','lane','jizda','source_ref','r7',
    'subject', jsonb_build_object('key','vuz:1'),
    'occurred_at', ${cas(1)})
)`;

beforeAll(async () => {
  await reportTestCapabilities("jádro projekce událostí");
  if (!dbAvailable) return;
  psqlMultiline(`${HEADER}
DELETE FROM public.twin_events WHERE source = '${ZDROJ}:jizda';
DELETE FROM public.twin_entities WHERE id IN ('${VA}', '${VB}', '${RD}');
INSERT INTO aisha_auth.users (id, email) VALUES ('${ADMIN}', 'jadro-spravce@test.local') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (user_id, email) VALUES ('${ADMIN}', 'jadro-spravce@test.local') ON CONFLICT (user_id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin') ON CONFLICT DO NOTHING;
INSERT INTO public.twin_entities (id, entity_type, label) VALUES
  ('${VA}', 'vehicle', 'zz vůz A'), ('${VB}', 'vehicle', 'zz vůz B'), ('${RD}', 'driver', 'zz řidič');
-- Potvrzené vazby; čip X předán z vozu A na vůz B před 5 dny.
INSERT INTO public.twin_external_refs
  (twin_id, source, source_key, ref_kind, state, proposed_by, confirmed_at, valid_from, valid_to) VALUES
  ('${VA}', '${ZDROJ}', 'vuz:1',    'primary_id',     'confirmed', 'test', now(), ${cas(30)}, NULL),
  ('${RD}', '${ZDROJ}', 'osoba:1',  'primary_id',     'confirmed', 'test', now(), ${cas(30)}, NULL),
  ('${VA}', '${ZDROJ}', 'cip:X',    'field_identity', 'confirmed', 'test', now(), ${cas(30)}, ${cas(5)}),
  ('${VB}', '${ZDROJ}', 'cip:X',    'field_identity', 'confirmed', 'test', now(), ${cas(5)},  NULL),
  -- klíč „vozidla", který ve skutečnosti drží ŘIDIČ (třída chyby z T-cars)
  ('${RD}', '${ZDROJ}', 'zamena:1', 'primary_id',     'confirmed', 'test', now(), ${cas(30)}, NULL);`);
});

describe.skipIf(!dbAvailable)("jádro projekce událostí", () => {
  it("resolve k času události, kontrola druhu entity, nerozřešené a neplatné jen spočítá", () => {
    const r = JSON.parse(sluzba(`SELECT public.twin_project_events('${ZDROJ}', ${DAVKA})::text;`));
    expect(r).toEqual({
      prijato: 7, nove: 4, zmenene: 0, beze_zmeny: 0,
      bez_vazby: 1, // r6 — nikdo takový
      jiny_druh: 2, // r4 subjekt je řidič; r5 druhá strana je vozidlo, ne řidič
      neplatne: 1, // r7 bez druhu entity
    });

    const u = (ref: string) =>
      JSON.parse(sluzba(`SELECT coalesce((SELECT json_build_object('twin', twin_id, 'rel', related_twin_id)::text
                             FROM public.twin_events WHERE source = '${ZDROJ}:jizda' AND source_ref = '${ref}'), '{}');`));
    expect(u("r1")).toEqual({ twin: VA, rel: RD });
    expect(u("r2").twin).toBe(VA); // čip X před předáním → vůz A
    expect(u("r3").twin).toBe(VB); // čip X po předání → vůz B
    expect(u("r4")).toEqual({}); // subjekt jiného druhu se nezapíše
    expect(u("r5")).toEqual({ twin: VA, rel: null }); // druhá strana jiného druhu se vynechá
  });

  it("další volání beze změn nic nezapíše", () => {
    expect(JSON.parse(sluzba(`SELECT public.twin_project_events('${ZDROJ}', ${DAVKA})::text;`))).toMatchObject({
      nove: 0, zmenene: 0, beze_zmeny: 4,
    });
  });

  it("projekci smí spustit jen zdroj", () => {
    expect(zkusJako(ADMIN, `SELECT public.twin_project_events('x', '[]'::jsonb)`)).toMatch(/permission denied/);
  });
});
