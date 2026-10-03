import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline, psqlQuery } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * Jízdy zdrojů → události dvojčat a návrhy vazeb identity (2026-09-26).
 *
 * ⛔ NAMĚŘENO v produkci instance: 12 dvojčat vozidel z ingestu a 0 událostí
 * 'trip' — žádná jízda žádného zdroje se na dvojčata nedostala, dlaždice
 * vozového parku ukazují NEMĚŘENO. Vozidla ze zdrojů telematiky navíc nesmí
 * zakládat vlastní dvojčata (majitel 24. 9.: vazby z ingestu, potvrzené
 * z několika stran, jistota roste se shodou).
 *
 * Měří se nad skutečnou DB přes adaptéry T-cars (tc_propose_identity,
 * tc_project_rides), takže se ověří i obecné jádro pod nimi:
 *   • návrh = shoda signálů s referencemi JINÝCH zdrojů, jistota roste,
 *     nejednoznačnost se přizná, lidské „ne" se nevrací, nové dvojče nikdy;
 *   • projekce = jen potvrzená a k času jízdy platná vazba, zápis jen nového
 *     a změněného, místa se nepřenášejí, nárok jen služba.
 */
const dbAvailable = isPgReachable();
const HEADER = "\\set ON_ERROR_STOP on\n";
const ADMIN = "66666666-6666-4666-8666-666666666601";
const BEZNY = "66666666-6666-4666-8666-666666666602";
const VUZ = "66666666-6666-4666-8666-6666666666a1";
const VUZ2 = "66666666-6666-4666-8666-6666666666a2";
const RIDIC = "66666666-6666-4666-8666-6666666666b1";
const DRAHA = "tcars-fleet:trip";

/** Jeden výsledek (poslední řádek) pod service_role. */
const sluzba = (sql: string) =>
  psqlQuery(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true) IS NOT NULL AND true; ${sql}`)
    .trim()
    .split("\n")
    .pop() ?? "";

const sluzbaJson = (sql: string) => JSON.parse(sluzba(sql)) as Record<string, number> & Record<string, unknown>;

/** Úkon člověka (správce), který se MÁ zapsat — potvrzení/zamítnutí vazby. */
const jakoSpravce = (sql: string) =>
  psqlMultiline(`${HEADER}BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"${ADMIN}"}', true);
SELECT (${sql})::text;
COMMIT;`);

/** Pokus pod přihlášeným uživatelem, který MÁ selhat — vrací text chyby, nebo 'PROSLO'. */
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

const navrh = (twin: string, key: string) =>
  sluzba(`SELECT coalesce(json_build_object('confidence', confidence, 'proposed_by', proposed_by,
            'note', note, 'state', state, 'id', id)::text, '{}')
            FROM public.twin_external_refs
           WHERE twin_id = '${twin}' AND source = 'tcars-fleet' AND source_key = '${key}' AND ref_kind = 'primary_id';`);

const udalosti = () =>
  Number(sluzba(`SELECT count(*) FROM public.twin_events WHERE source = '${DRAHA}' AND source_ref LIKE '9900%';`));

beforeAll(async () => {
  await reportTestCapabilities("jízdy zdrojů → dvojčata");
  if (!dbAvailable) return;
  psqlMultiline(`${HEADER}
DELETE FROM public.twin_events WHERE source = '${DRAHA}' AND source_ref LIKE '9900%';
DELETE FROM public.tc_rides WHERE tc_ride_id BETWEEN 990000 AND 990999;
DELETE FROM public.tc_vehicles WHERE tc_vehicle_id BETWEEN 990000 AND 990999;
DELETE FROM public.tc_drivers WHERE tc_driver_id BETWEEN 990000 AND 990999;
DELETE FROM public.twin_entities WHERE id IN ('${VUZ}', '${VUZ2}', '${RIDIC}');
INSERT INTO aisha_auth.users (id, email) VALUES
  ('${ADMIN}', 'jizdy-spravce@test.local'), ('${BEZNY}', 'jizdy-bezny@test.local')
ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (user_id, email) VALUES
  ('${ADMIN}', 'jizdy-spravce@test.local'), ('${BEZNY}', 'jizdy-bezny@test.local')
ON CONFLICT (user_id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin') ON CONFLICT DO NOTHING;

-- Dvojčata, jak je založil ingest: potvrzený primární klíč + NAVRŽENÉ
-- identifikační parametry z dokladů (číslo stroje, RZ, palubní jednotka).
INSERT INTO public.twin_entities (id, entity_type, label) VALUES
  ('${VUZ}', 'vehicle', 'zz-98872'), ('${VUZ2}', 'vehicle', 'zz-98873'), ('${RIDIC}', 'driver', 'zz řidič');
INSERT INTO public.twin_external_refs (twin_id, source, source_key, ref_kind, state, proposed_by, confirmed_at) VALUES
  ('${VUZ}',   'zz-ingest', 'zz-98872',     'primary_id',             'confirmed', 'test', now()),
  ('${VUZ}',   'zz-ingest', '98872',        'vehicle_machine_id',     'proposed',  'test', NULL),
  ('${VUZ}',   'zz-ingest', 'ZZ1 2345',     'vehicle_machine_plate',  'proposed',  'test', NULL),
  ('${VUZ}',   'zz-ingest', '99148574816',  'vehicle_telemetry_unit', 'proposed',  'test', NULL),
  ('${VUZ2}',  'zz-ingest', 'zz-98873',     'primary_id',             'confirmed', 'test', now()),
  ('${VUZ2}',  'zz-ingest', '98873',        'vehicle_machine_id',     'proposed',  'test', NULL),
  ('${RIDIC}', 'zz-ingest', 'Zkušební Řidič', 'driver_name',          'proposed',  'test', NULL);

-- Číselník T-cars: tři shody na jedno vozidlo, jedna shoda, ROZPOR (RZ ukazuje
-- na jedno dvojče, evidenční číslo na druhé) a vozidlo, o kterém nikdo neví.
INSERT INTO public.tc_vehicles (tc_vehicle_id, plate, unit_no, evidence_no) VALUES
  (990001, 'zz1-2345', '99148574816', '098872'),
  (990002, NULL,       NULL,          '98873'),
  (990003, 'ZZ1 2345', NULL,          '98873'),
  (990004, 'XX0 0000', NULL,          NULL);
-- Velikost písmen s diakritikou závisí na locale DB, mezery ne — test měří jen to druhé.
-- Řidič má ZÁMĚRNĚ totéž číslo jako vozidlo 990001: T-cars čísluje vozidla
-- a osoby zvlášť, klíč identity proto musí nést druh objektu.
INSERT INTO public.tc_drivers (tc_driver_id, name) VALUES (990001, 'Zkušební  Řidič');`);
});

describe.skipIf(!dbAvailable)("návrhy vazeb ze shody signálů", () => {
  it("navrhne, ale NEZALOŽÍ dvojče; víc shodných signálů = vyšší jistota", () => {
    const dvojcatPred = Number(sluzba(`SELECT count(*) FROM public.twin_entities;`));

    const vysledek = JSON.parse(sluzba(`SELECT public.tc_propose_identity()::text;`)) as {
      vozidla: Record<string, number>;
      ridici: Record<string, number>;
    };

    expect(vysledek.vozidla).toMatchObject({
      objektu: 4,
      potvrzeno: 0,
      navrzeno: 4, // 990001→VUZ, 990002→VUZ2, 990003→VUZ i VUZ2
      nejednoznacne: 1,
      bez_kandidata: 1,
    });
    expect(vysledek.ridici).toMatchObject({ objektu: 1, navrzeno: 1 });
    expect(Number(sluzba(`SELECT count(*) FROM public.twin_entities;`))).toBe(dvojcatPred);

    // Tři nezávislé shody (jednotka 0,8 · RZ 0,6 · evidenční číslo 0,5) → strop 0,95.
    const silny = JSON.parse(navrh(VUZ, "vozidlo:990001"));
    expect(Number(silny.confidence)).toBe(0.95);
    expect(silny.state).toBe("proposed");
    // Důkaz je v `proposed_by` (fronta ho ukazuje) — druhy, nikdy hodnoty.
    expect(silny.proposed_by).toBe(
      "rule:signals:vehicle_machine_id+vehicle_machine_plate+vehicle_telemetry_unit",
    );
    expect(silny.proposed_by).not.toContain("2345");

    const slaby = JSON.parse(navrh(VUZ2, "vozidlo:990002"));
    expect(Number(slaby.confidence)).toBe(0.5);
  });

  it("rozpor dat přizná: oba kandidáti s poloviční jistotou a poznámkou", () => {
    const naVuz = JSON.parse(navrh(VUZ, "vozidlo:990003"));
    const naVuz2 = JSON.parse(navrh(VUZ2, "vozidlo:990003"));
    expect(Number(naVuz.confidence)).toBe(0.3);
    expect(Number(naVuz2.confidence)).toBe(0.25);
    expect(naVuz.note).toBe("nejednoznačné: 2 kandidátů");
  });

  it("opakované volání nic nezdvojí a lidské NE se nevrací", () => {
    const zamitnout = JSON.parse(navrh(VUZ2, "vozidlo:990003")).id as string;
    jakoSpravce(`public.twin_identity_reject_binding('${zamitnout}', 'test: rozpor')`);

    const znovu = JSON.parse(sluzba(`SELECT public.tc_propose_identity()::text;`)) as {
      vozidla: Record<string, number>;
    };
    expect(znovu.vozidla).toMatchObject({ navrzeno: 0, uz_navrzeno: 3, zamitnuto_clovekem: 1 });
  });

  it("návrhy smí dělat jen zdroj — ani přihlášený správce ne", () => {
    expect(zkusJako(BEZNY, "SELECT public.tc_propose_identity()")).toMatch(/permission denied/);
    expect(zkusJako(ADMIN, "SELECT public.tc_propose_identity()")).toMatch(/permission denied/);
    expect(
      zkusJako(ADMIN, `SELECT public.twin_propose_identity_by_signals('x', 'vehicle', '[]'::jsonb)`),
    ).toMatch(/permission denied/);
  });
});

describe.skipIf(!dbAvailable)("projekce jízd na dvojčata", () => {
  const cekaPred = () => sluzbaJson(`SELECT public.tc_project_rides()::text;`).ceka_na_vazbu as number;

  it("bez potvrzené vazby se nezapíše nic — jízdy jen čekají", () => {
    const pred = cekaPred();
    psqlMultiline(`${HEADER}
INSERT INTO public.tc_rides (tc_ride_id, tc_vehicle_id, tc_driver_id, start_time, end_time,
                             distance_km, odometer_start_km, odometer_end_km, private,
                             start_place, end_place, purpose) VALUES
  (990011, 990001, 990001, now() - interval '5 hours', now() - interval '4 hours', 42.50, 1000, 1042.5, false,
   'Domov řidiče 1', 'Stavba', 'test'),
  (990012, 990001, 990001, now() - interval '3 hours', now() - interval '2 hours', 17.00, 1042.5, 1059.5, true,
   'Stavba', 'Domov řidiče 1', 'test'),
  (990013, 990001, NULL,   now() - interval '1 hours', now() - interval '2 hours', 3.00, NULL, NULL, false,
   NULL, NULL, 'konec před začátkem');`);

    const r = sluzbaJson(`SELECT public.tc_project_rides()::text;`);
    expect(r).toMatchObject({ prijato: 0, nove: 0 });
    expect(r.ceka_na_vazbu).toBe(pred + 3);
    expect(udalosti()).toBe(0);
  });

  it("vazba potvrzená TEĎ neplatí zpětně — starší jízdy dál čekají (rozhodnutí 26. 9.)", () => {
    const ref = JSON.parse(navrh(VUZ, "vozidlo:990001")).id as string;
    jakoSpravce(`public.twin_identity_confirm_binding('${ref}')`);

    const r = sluzbaJson(`SELECT public.tc_project_rides()::text;`);
    expect(r.nove).toBe(0);
    expect(udalosti()).toBe(0);
  });

  it("jakmile vazba k času jízdy platí, historie se dopromítne sama", () => {
    // Simuluje jádro identity s platností od nejstaršího důkazu (upstream,
    // čeká na majitele): projekce se nemění, jen začne vazbu vidět.
    psqlMultiline(`${HEADER}
UPDATE public.twin_external_refs SET valid_from = now() - interval '1 day'
 WHERE source = 'tcars-fleet' AND source_key = 'vozidlo:990001' AND ref_kind = 'primary_id' AND state = 'confirmed';`);

    const r = sluzbaJson(`SELECT public.tc_project_rides()::text;`);
    expect(r).toMatchObject({ prijato: 3, nove: 2, zmenene: 0, neplatne: 1, bez_vazby_vozidla: 0 });
    expect(udalosti()).toBe(2);

    const u = JSON.parse(
      sluzba(`SELECT json_build_object('twin', twin_id, 'ridic', related_twin_id, 'attrs', attrs)::text
                FROM public.twin_events WHERE source = '${DRAHA}' AND source_ref = '990011';`),
    );
    expect(u.twin).toBe(VUZ);
    expect(u.ridic).toBeNull(); // řidič zatím bez potvrzené vazby — jízdu to neblokuje
    expect(u.attrs).toEqual({ distance_km: 42.5, odometer_start_km: 1000, odometer_end_km: 1042.5, private: false });
    // Místa ani účel se nepřenášejí: polohy nepovoleny, adresa je osobní údaj.
    expect(JSON.stringify(u.attrs)).not.toMatch(/Domov|Stavba|test/);
  });

  it("další takt beze změn nic nezapíše; potvrzený řidič a zpětná oprava ano", () => {
    expect(sluzbaJson(`SELECT public.tc_project_rides()::text;`)).toMatchObject({ nove: 0, zmenene: 0, beze_zmeny: 2 });

    const refRidice = JSON.parse(
      sluzba(`SELECT json_build_object('id', id)::text FROM public.twin_external_refs
               WHERE source = 'tcars-fleet' AND source_key = 'osoba:990001' AND ref_kind = 'primary_id';`),
    ).id as string;
    jakoSpravce(`public.twin_identity_confirm_binding('${refRidice}')`);
    psqlMultiline(`${HEADER}
UPDATE public.twin_external_refs SET valid_from = now() - interval '1 day'
 WHERE source = 'tcars-fleet' AND source_key = 'osoba:990001' AND ref_kind = 'primary_id' AND state = 'confirmed';
UPDATE public.tc_rides SET distance_km = 43.00, updated_at = now() WHERE tc_ride_id = 990011;`);

    expect(sluzbaJson(`SELECT public.tc_project_rides()::text;`)).toMatchObject({ nove: 0, zmenene: 2 });
    expect(
      sluzba(`SELECT (attrs->>'distance_km') || '|' || (related_twin_id = '${RIDIC}')
                FROM public.twin_events WHERE source = '${DRAHA}' AND source_ref = '990011';`),
    ).toBe("43.00|true");
    expect(udalosti()).toBe(2);
  });

  it("projekci smí spustit jen zdroj", () => {
    expect(zkusJako(BEZNY, "SELECT public.tc_project_rides()")).toMatch(/permission denied/);
    expect(zkusJako(ADMIN, `SELECT public.twin_project_trips('x', '[]'::jsonb)`)).toMatch(/permission denied/);
  });
});
