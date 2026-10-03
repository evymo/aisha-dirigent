import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline, psqlQuery } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * Eurowag → dvojčata (2026-09-27): adaptéry ew_propose_identity
 * a ew_project_catalog nad obecnou surovou dráhou (source_catalog_rows),
 * kam plugin 0.2.0 ukládá místo zakládání dvojčat.
 *
 * Měří se nad skutečnou DB:
 *   • návrhy: vozidlo podle SPZ, řidič podle jména; nic nového nevznikne;
 *   • KOLIZE KLÍČŮ: vozidlo 5 × řidič 5 → 'vozidlo:5' ≠ 'osoba:5'
 *     (0.1.0 je měl latentně stejné — lekce T-cars 27. 9.);
 *   • jízda → 'trip' se spotřebou (katalog trip_consumption_l), bez míst;
 *   • stav → 'vehicle_state' s hladinou a tachometrem, BEZ polohy; stav
 *     starší než okno stavů se nepromítá;
 *   • bez potvrzené vazby nic; nárok jen zdroj.
 */
const dbAvailable = isPgReachable();
const HEADER = "\\set ON_ERROR_STOP on\n";
const ADMIN = "11111111-1111-4111-8111-111111111101";
const E5 = "11111111-1111-4111-8111-1111111111a5";
const O5 = "11111111-1111-4111-8111-1111111111b5";

const sluzba = (sql: string) =>
  psqlQuery(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true) IS NOT NULL AND true; ${sql}`)
    .trim()
    .split("\n")
    .pop() ?? "";

const jakoSpravce = (sql: string) =>
  psqlMultiline(`${HEADER}BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"${ADMIN}"}', true);
SELECT (${sql})::text;
COMMIT;`);

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

const ref = (key: string) =>
  JSON.parse(
    sluzba(`SELECT coalesce((SELECT json_build_object('id', id, 'twin', twin_id, 'confidence', confidence,
                                   'proposed_by', proposed_by)::text
                               FROM public.twin_external_refs
                              WHERE source = 'eurowag-telematics' AND source_key = '${key}' AND ref_kind = 'primary_id'
                              ORDER BY created_at DESC LIMIT 1), '{}');`),
  );

const potvrdit = (key: string) => {
  jakoSpravce(`public.twin_identity_confirm_binding('${ref(key).id}')`);
  psqlMultiline(`${HEADER}
UPDATE public.twin_external_refs SET valid_from = now() - interval '60 days'
 WHERE source = 'eurowag-telematics' AND source_key = '${key}' AND ref_kind = 'primary_id' AND state = 'confirmed';`);
};

const udalost = (source: string, ref_: string) =>
  JSON.parse(
    sluzba(`SELECT coalesce((SELECT json_build_object('twin', twin_id, 'rel', related_twin_id, 'attrs', attrs)::text
                               FROM public.twin_events WHERE source = '${source}' AND source_ref = '${ref_}'), '{}');`),
  );

const projekce = () => JSON.parse(sluzba(`SELECT public.ew_project_catalog()::text;`));

beforeAll(async () => {
  await reportTestCapabilities("Eurowag → dvojčata");
  if (!dbAvailable) return;
  psqlMultiline(`${HEADER}
DELETE FROM public.twin_events WHERE source LIKE 'eurowag-telematics:%';
DELETE FROM public.twin_external_refs WHERE source = 'eurowag-telematics';
DELETE FROM public.source_catalog_rows WHERE source_slug = 'eurowag-telematics';
DELETE FROM public.twin_entities WHERE id IN ('${E5}', '${O5}');
DELETE FROM public.twin_parameter_definitions WHERE code IN ('zz_ew_spotreba', 'zz_ew_hladina');
INSERT INTO aisha_auth.users (id, email) VALUES ('${ADMIN}', 'ew-spravce@test.local') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (user_id, email) VALUES ('${ADMIN}', 'ew-spravce@test.local') ON CONFLICT (user_id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin') ON CONFLICT DO NOTHING;

INSERT INTO public.twin_parameter_definitions (code, name, entity_type, data_type, unit, source, metadata) VALUES
  ('zz_ew_spotreba', 'Spotřeba', 'vehicle', 'decimal', 'l', 'eurowag-telematics', '{"event_type":"trip","attr":"consumption_l"}'::jsonb),
  ('zz_ew_hladina',  'Hladina',  'vehicle', 'decimal', 'l', 'eurowag-telematics', '{"event_type":"vehicle_state","attr":"fuel_level_l"}'::jsonb);

INSERT INTO public.twin_entities (id, entity_type, label) VALUES ('${E5}', 'vehicle', 'zz tahač'), ('${O5}', 'driver', 'zz řidič EW');
INSERT INTO public.twin_external_refs (twin_id, source, source_key, ref_kind, state, proposed_by) VALUES
  ('${E5}', 'zz-ingest', '5ZZ 0005',          'vehicle_machine_plate', 'proposed', 'test'),
  ('${O5}', 'zz-ingest', 'Eurowag Testovací', 'driver_name',           'proposed', 'test');

-- Vozidlo i řidič mají u Eurowagu ZÁMĚRNĚ totéž číslo 5.
INSERT INTO public.source_catalog_rows (source_slug, kind, external_id, occurred_at, fields, synced_at) VALUES
  ('eurowag-telematics', 'vehicle', '5', NULL, '{"rn":"5ZZ  0005"}', now()),
  ('eurowag-telematics', 'driver',  '5', NULL, '{"name":"Eurowag","surname":"Testovací"}', now()),
  ('eurowag-telematics', 'trip', 'trip-ew-1', now() - interval '3 hours',
   '{"monitored_object_id":5,"driver_id":5,"distance_km":42,"consumption_l":12.5,"consumption_l_100km":29.8,"duration_s":3452}', now()),
  ('eurowag-telematics', 'vehicle_state', '5:nyni', now() - interval '1 hours',
   '{"monitored_object_id":5,"odometer_km":11028,"fuel_level_l":300,"ignition":true}', now()),
  ('eurowag-telematics', 'vehicle_state', '5:stary', now() - interval '40 days',
   '{"monitored_object_id":5,"odometer_km":10000,"fuel_level_l":100,"ignition":false}', now());`);
});

describe.skipIf(!dbAvailable)("Eurowag → dvojčata", () => {
  it("návrhy: vozidlo podle SPZ, řidič podle jména — dva různé klíče pro číslo 5", () => {
    const dvojcat = sluzba(`SELECT count(*) FROM public.twin_entities;`);
    const r = JSON.parse(sluzba(`SELECT public.ew_propose_identity()::text;`));
    expect(r.vozidla).toMatchObject({ objektu: 1, navrzeno: 1 });
    expect(r.ridici).toMatchObject({ objektu: 1, navrzeno: 1 });
    expect(sluzba(`SELECT count(*) FROM public.twin_entities;`)).toBe(dvojcat);
    expect(ref("vozidlo:5")).toMatchObject({ twin: E5, proposed_by: "rule:signals:vehicle_machine_plate" });
    expect(Number(ref("vozidlo:5").confidence)).toBe(0.6);
    expect(ref("osoba:5")).toMatchObject({ twin: O5, proposed_by: "rule:signals:driver_name" });
  });

  it("bez potvrzené vazby se nepromítne nic", () => {
    const r = projekce();
    expect(r.jizdy).toMatchObject({ nove: 0, ceka_na_vazbu: 1 });
    expect(r.stavy).toMatchObject({ nove: 0, ceka_na_vazbu: 1 }); // starý stav je mimo okno
  });

  it("po potvrzení: jízda se spotřebou a řidičem, stav s hladinou — bez polohy; starý stav ne", () => {
    potvrdit("vozidlo:5");
    potvrdit("osoba:5");
    const r = projekce();
    expect(r.jizdy).toMatchObject({ nove: 1, jiny_druh: 0 });
    expect(r.stavy).toMatchObject({ nove: 1, jiny_druh: 0 });

    const j = udalost("eurowag-telematics:trip", "trip-ew-1");
    expect(j).toMatchObject({ twin: E5, rel: O5 });
    expect(j.attrs).toEqual({ distance_km: 42, consumption_l: 12.5, consumption_l_100km: 29.8, duration_seconds: 3452 });

    const s = udalost("eurowag-telematics:vehicle-state", "5:nyni");
    expect(s).toMatchObject({ twin: E5, attrs: { odometer_km: 11028, fuel_level_l: 300, ignition: true } });
    expect(JSON.stringify([j, s])).not.toMatch(/lat|lon|speed|place/);
    expect(udalost("eurowag-telematics:vehicle-state", "5:stary")).toEqual({});

    expect(
      sluzba(`SELECT value::text FROM public.twin_param_agg('zz_ew_spotreba', 'sum', now() - interval '7 days', NULL, 'vehicle')
               WHERE twin_id = '${E5}';`),
    ).toBe("12.5");
    expect(
      sluzba(`SELECT value::text FROM public.twin_param_agg('zz_ew_hladina', 'last', now() - interval '7 days', NULL, 'vehicle')
               WHERE twin_id = '${E5}';`),
    ).toBe("300");
    // Další takt beze změn nic nezapíše.
    expect(projekce()).toMatchObject({ jizdy: { nove: 0, zmenene: 0 }, stavy: { nove: 0, zmenene: 0 } });
  });

  it("adaptéry smí volat jen zdroj", () => {
    for (const fn of ["ew_propose_identity()", "ew_project_catalog()"]) {
      expect(zkusJako(ADMIN, `SELECT public.${fn}`)).toMatch(/permission denied/);
    }
  });
});
