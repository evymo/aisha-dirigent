import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline, psqlQuery } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * Webdispečink → dvojčata (2026-09-27): adaptéry wd_propose_identity,
 * wd_project_rides a wd_project_worktime nad registrem, který plugin už plní
 * (wd_vehicles, wd_drivers, wd_rides, wd_worktime).
 *
 * Měří se nad skutečnou DB:
 *   • návrhy: vozidlo podle identifikátoru (RZ), řidič podle osobního čísla;
 *     nic nového nevznikne;
 *   • KOLIZE KLÍČŮ: vozidlo 5 a řidič 5 — WD čísluje obojí zvlášť, klíč
 *     řidiče proto nese druh ('ridic:5'), vozidlo zůstává holé (konvence
 *     jádra) — lekce T-cars 27. 9.;
 *   • jízda → 'trip' na vozidle s řidičem; místa/účel/posádka/rychlost NE;
 *   • denní výkon z tachografu → 'driver_hours_day' na ŘIDIČI s drive_seconds,
 *     které katalog převede na hodiny (driver_drive_h, ÷3600);
 *   • bez potvrzené vazby nic; nárok jen zdroj.
 */
const dbAvailable = isPgReachable();
const HEADER = "\\set ON_ERROR_STOP on\n";
const ADMIN = "22222222-2222-4222-8222-222222222201";
const W5 = "22222222-2222-4222-8222-2222222222a5";
const R5 = "22222222-2222-4222-8222-2222222222b5";

const sluzba = (sql: string) =>
  psqlQuery(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true) IS NOT NULL AND true; ${sql}`)
    .trim()
    .split("\n")
    .pop() ?? "";
const sluzbaJson = (sql: string) => JSON.parse(sluzba(sql)) as Record<string, number> & Record<string, unknown>;

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
                              WHERE source = 'webdispecink' AND source_key = '${key}' AND ref_kind = 'primary_id'
                              ORDER BY created_at DESC LIMIT 1), '{}');`),
  );

const potvrdit = (key: string) => {
  jakoSpravce(`public.twin_identity_confirm_binding('${ref(key).id}')`);
  psqlMultiline(`${HEADER}
UPDATE public.twin_external_refs SET valid_from = now() - interval '5 days'
 WHERE source = 'webdispecink' AND source_key = '${key}' AND ref_kind = 'primary_id' AND state = 'confirmed';`);
};

const udalost = (source: string, ref_: string) =>
  JSON.parse(
    sluzba(`SELECT coalesce((SELECT json_build_object('twin', twin_id, 'rel', related_twin_id, 'attrs', attrs)::text
                               FROM public.twin_events WHERE source = '${source}' AND source_ref = '${ref_}'), '{}');`),
  );

beforeAll(async () => {
  await reportTestCapabilities("Webdispečink → dvojčata");
  if (!dbAvailable) return;
  psqlMultiline(`${HEADER}
DELETE FROM public.twin_events WHERE source LIKE 'webdispecink:%';
DELETE FROM public.twin_external_refs WHERE source = 'webdispecink';
DELETE FROM public.wd_rides WHERE wd_ride_id BETWEEN 880000 AND 880999;
DELETE FROM public.wd_worktime WHERE wd_driver_id = 5;
DELETE FROM public.wd_vehicles WHERE wd_car_id = 5;
DELETE FROM public.wd_drivers WHERE wd_driver_id = 5;
DELETE FROM public.twin_entities WHERE id IN ('${W5}', '${R5}');
DELETE FROM public.twin_parameter_definitions WHERE code = 'zz_wd_rizeni_h';
INSERT INTO aisha_auth.users (id, email) VALUES ('${ADMIN}', 'wd-spravce@test.local') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (user_id, email) VALUES ('${ADMIN}', 'wd-spravce@test.local') ON CONFLICT (user_id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin') ON CONFLICT DO NOTHING;

INSERT INTO public.twin_parameter_definitions (code, name, entity_type, data_type, unit, source, metadata)
VALUES ('zz_wd_rizeni_h', 'Doba řízení', 'driver', 'decimal', 'h', 'webdispecink:tachograph',
        '{"event_type":"driver_hours_day","attr":"drive_seconds","scale_div":3600}'::jsonb);

INSERT INTO public.twin_entities (id, entity_type, label) VALUES ('${W5}', 'vehicle', 'zz Tatra'), ('${R5}', 'driver', 'zz řidič');
INSERT INTO public.twin_external_refs (twin_id, source, source_key, ref_kind, state, proposed_by) VALUES
  ('${W5}', 'zz-ingest', '1A1 1111', 'vehicle_machine_plate',  'proposed', 'test'),
  ('${R5}', 'zz-ingest', 'A-7',      'driver_personal_number', 'proposed', 'test');

-- Vozidlo i řidič mají ve WD ZÁMĚRNĚ totéž číslo 5.
INSERT INTO public.wd_vehicles (wd_car_id, identifier, description, active) VALUES (5, '1A1 1111', 'Tatra', true);
INSERT INTO public.wd_drivers (wd_driver_id, first_name, last_name, personal_number, active)
VALUES (5, 'Wendelín', 'Tachografový', 'A-7', true);
INSERT INTO public.wd_rides (wd_ride_id, wd_car_id, wd_driver_id, start_time, end_time, start_place, end_place,
                             purpose, crew, distance_km, driving_seconds, max_speed_kmh)
VALUES (880001, 5, 5, now() - interval '3 hours', now() - interval '2 hours', 'Domov řidiče', 'Stavba',
        'soukromá', 'kolega', 42.00, 3000, 131.0);
INSERT INTO public.wd_worktime (wd_driver_id, car_identifikator, work_date, total_drive_seconds,
                                total_work_seconds, total_rest_seconds, total_standby_seconds, distance_km, absences)
VALUES (5, '1A1 1111', current_date - 1, 7200, 1800, 39600, 600, 180.00, '[{"typ":"dovolená"}]'::jsonb);`);
});

describe.skipIf(!dbAvailable)("Webdispečink → dvojčata", () => {
  it("návrhy: vozidlo podle RZ, řidič podle osobního čísla — dva různé klíče pro číslo 5", () => {
    // ⭐ NAD SVÝM ZDROJEM, ne nad celou tabulkou: v souběžné sadě dvojčata zakládají
    // jiné testy (naměřeno 2026-10-05: 35 → 36 bez přispění wd_propose_identity).
    // Nové dvojče od návrhu by neslo referenci 'webdispecink' (fixtura je na začátku
    // všechny maže) a nebylo by W5 ani R5.
    const cizichDvojcat = () =>
      sluzba(`SELECT count(DISTINCT twin_id) FROM public.twin_external_refs
               WHERE source = 'webdispecink' AND twin_id NOT IN ('${W5}', '${R5}');`);
    const dvojcat = cizichDvojcat();
    const r = JSON.parse(sluzba(`SELECT public.wd_propose_identity()::text;`));
    expect(r.vozidla).toMatchObject({ objektu: 1, navrzeno: 1 });
    expect(r.ridici).toMatchObject({ objektu: 1, navrzeno: 1 });
    expect(cizichDvojcat(), "návrh založil dvojče").toBe(dvojcat);
    expect(ref("5")).toMatchObject({ twin: W5, proposed_by: "rule:signals:vehicle_machine_plate" });
    expect(ref("ridic:5")).toMatchObject({ twin: R5, proposed_by: "rule:signals:driver_personal_number" });
    expect(Number(ref("ridic:5").confidence)).toBe(0.7);
  });

  it("bez potvrzené vazby se nepromítne nic", () => {
    expect(sluzbaJson(`SELECT public.wd_project_rides()::text;`)).toMatchObject({ nove: 0, ceka_na_vazbu: 1 });
    expect(sluzbaJson(`SELECT public.wd_project_worktime()::text;`)).toMatchObject({ nove: 0, ceka_na_vazbu: 1 });
  });

  it("po potvrzení: jízda na vozidle s řidičem (ne s vozidlem 5), bez míst a osobních údajů", () => {
    potvrdit("5");
    potvrdit("ridic:5");
    expect(sluzbaJson(`SELECT public.wd_project_rides()::text;`)).toMatchObject({ nove: 1, jiny_druh: 0 });
    const u = udalost("webdispecink:trip", "880001");
    expect(u.twin).toBe(W5);
    expect(u.rel).toBe(R5);
    expect(u.attrs).toEqual({ distance_km: 42, driving_seconds: 3000 });
    expect(JSON.stringify(u.attrs)).not.toMatch(/Domov|Stavba|soukromá|kolega|131/);
  });

  it("denní výkon z tachografu → driver_hours_day na řidiči; katalog ho převede na hodiny", () => {
    expect(sluzbaJson(`SELECT public.wd_project_worktime()::text;`)).toMatchObject({ nove: 1, jiny_druh: 0 });
    const den = sluzba(`SELECT (current_date - 1)::text;`);
    const u = udalost("webdispecink:tachograph", `5:${den}:1A1 1111`);
    expect(u.twin).toBe(R5);
    expect(u.attrs).toMatchObject({ drive_seconds: 7200, work_date: den, car: "1A1 1111" });
    expect(JSON.stringify(u.attrs)).not.toMatch(/dovolená/); // nepřítomnosti se nepřenáší
    expect(
      sluzba(`SELECT value::text FROM public.twin_param_agg('zz_wd_rizeni_h', 'sum', now() - interval '7 days', NULL, 'driver')
               WHERE twin_id = '${R5}';`),
    ).toBe("2");
    // Další takt beze změn nic nezapíše.
    expect(sluzbaJson(`SELECT public.wd_project_worktime()::text;`)).toMatchObject({ nove: 0, zmenene: 0 });
  });

  it("adaptéry smí volat jen zdroj", () => {
    for (const fn of ["wd_propose_identity()", "wd_project_rides()", "wd_project_worktime()"]) {
      expect(zkusJako(ADMIN, `SELECT public.${fn}`)).toMatch(/permission denied/);
    }
  });
});
