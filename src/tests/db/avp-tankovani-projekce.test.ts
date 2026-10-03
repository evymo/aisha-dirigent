import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline, psqlQuery } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * Tankování AVP → dvojčata (2026-09-27): adaptéry avp_propose_identity
 * a avp_project_fuelings nad obecnou surovou dráhou (source_catalog_rows).
 *
 * ⛔ PROČ: plugin AVP ukládá výdeje, ale na dvojčata je nikdo nepřenášel —
 * dlaždice „Natankováno" (fueling_liters) neměla odkud číst. Měří se:
 *   • návrhy: karta ↔ vozidlo podle RZ ve jménu karty, karta ↔ řidič podle
 *     jména; čip TRANZITIVNĚ na dvojče potvrzené karty; nic nového nevznikne;
 *   • platná verze = list řetězu oprav ∧ ¬hidden ∧ ¬removed; litry nese jen
 *     platná, pozdní oprava předchozí verzi v součtu VYNULUJE (rodič se znovu
 *     pošle, i když sám synchronizován nebyl);
 *   • výdej bez karty vozidla jde přes čip; výdej bez obojího se jen spočítá;
 *   • kolize klíčů: karta 5 ≠ čip s kódem „5" (lekce T-cars 27. 9.).
 */
const dbAvailable = isPgReachable();
const HEADER = "\\set ON_ERROR_STOP on\n";
const ADMIN = "33333333-3333-4333-8333-333333333301";
const V5 = "33333333-3333-4333-8333-3333333333a5";
const D6 = "33333333-3333-4333-8333-3333333333b6";
const DRAHA = "avp-portal:fueling";
const CIP_VOZU = "C0FFEE0000000001";

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

const ref = (key: string, kind: string) =>
  JSON.parse(
    sluzba(`SELECT coalesce((SELECT json_build_object('id', id, 'twin', twin_id, 'confidence', confidence,
                                   'proposed_by', proposed_by, 'state', state)::text
                               FROM public.twin_external_refs
                              WHERE source = 'avp-portal' AND source_key = '${key}' AND ref_kind = '${kind}'
                              ORDER BY created_at DESC LIMIT 1), '{}');`),
  );

/** Potvrdí návrh jako člověk a posune platnost do minulosti (výdeje jsou starší). */
const potvrdit = (key: string, kind: string) => {
  jakoSpravce(`public.twin_identity_confirm_binding('${ref(key, kind).id}')`);
  psqlMultiline(`${HEADER}
UPDATE public.twin_external_refs SET valid_from = now() - interval '2 days'
 WHERE source = 'avp-portal' AND source_key = '${key}' AND ref_kind = '${kind}' AND state = 'confirmed';`);
};

const udalost = (id: string) =>
  JSON.parse(
    sluzba(`SELECT coalesce((SELECT json_build_object('twin', twin_id, 'rel', related_twin_id, 'attrs', attrs)::text
                               FROM public.twin_events WHERE source = '${DRAHA}' AND source_ref = '${id}'), '{}');`),
  );

const soucet = () =>
  sluzba(`SELECT coalesce((SELECT value::text FROM public.twin_param_agg('zz_avp_litry', 'sum', now() - interval '7 days', NULL, 'vehicle')
                            WHERE twin_id = '${V5}'), 'NIC');`);

const vydej = (id: string, pole: string, pred = "3 hours") =>
  `('avp-portal', 'fueling', '${id}', now() - interval '${pred}', jsonb_build_object(${pole}), now())`;

beforeAll(async () => {
  await reportTestCapabilities("tankování AVP → dvojčata");
  if (!dbAvailable) return;
  psqlMultiline(`${HEADER}
DELETE FROM public.twin_events WHERE source = '${DRAHA}';
DELETE FROM public.source_catalog_rows WHERE source_slug = 'avp-portal';
DELETE FROM public.twin_external_refs WHERE source = 'avp-portal';
DELETE FROM public.twin_entities WHERE id IN ('${V5}', '${D6}');
DELETE FROM public.twin_parameter_definitions WHERE code = 'zz_avp_litry';
INSERT INTO aisha_auth.users (id, email) VALUES ('${ADMIN}', 'avp-spravce@test.local') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (user_id, email) VALUES ('${ADMIN}', 'avp-spravce@test.local') ON CONFLICT (user_id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin') ON CONFLICT DO NOTHING;

INSERT INTO public.twin_parameter_definitions (code, name, entity_type, data_type, unit, source, metadata)
VALUES ('zz_avp_litry', 'Natankováno', 'vehicle', 'decimal', 'l', 'avp-portal',
        '{"event_type":"fueling","attr":"liters"}'::jsonb);

-- Dvojčata z ingestu s NAVRŽENÝMI identifikačními parametry.
INSERT INTO public.twin_entities (id, entity_type, label) VALUES
  ('${V5}', 'vehicle', 'zz MAN'), ('${D6}', 'driver', 'zz řidič');
INSERT INTO public.twin_external_refs (twin_id, source, source_key, ref_kind, state, proposed_by) VALUES
  ('${V5}', 'zz-ingest', '7Z9 2093',     'vehicle_machine_plate', 'proposed', 'test'),
  ('${D6}', 'zz-ingest', 'Jan Zkušební', 'driver_name',           'proposed', 'test');

-- Katalog AVP: karta vozidla 5, karta řidiče 6; čip vozu → karta 5 a čip
-- s kódem „5" → karta ŘIDIČE 6 (klíč, který se tváří jako karta 5).
INSERT INTO public.source_catalog_rows (source_slug, kind, external_id, occurred_at, fields, synced_at) VALUES
  ('avp-portal', 'card', '5', NULL, '{"name":"MAN 7Z9 2093","card_type":"Vehicle"}', now()),
  ('avp-portal', 'card', '6', NULL, '{"name":"Jan Zkušební","card_type":"Driver"}', now()),
  ('avp-portal', 'chip', '${CIP_VOZU}', NULL, '{"chip_code":"${CIP_VOZU}","card_id":5}', now()),
  ('avp-portal', 'chip', '5', NULL, '{"chip_code":"5","card_id":6}', now()),
  ${vydej("101", `'vehicle_id',5,'driver_id',6,'liters',50`)},
  ${vydej("102", `'vehicle_id',5,'driver_id',6,'liters',55,'parent_id',101`)},
  ${vydej("103", `'vehicle_id',5,'liters',20,'hidden',true`)},
  ${vydej("104", `'vehicle_chip','c0ffee0000000001','driver_chip','5','liters',30`)},
  ${vydej("105", `'liters',7`)};`);
});

describe.skipIf(!dbAvailable)("tankování AVP → dvojčata", () => {
  it("návrhy: karta ↔ vozidlo podle RZ ve jménu, karta ↔ řidič podle jména; nic nového nevznikne", () => {
    const dvojcat = sluzba(`SELECT count(*) FROM public.twin_entities;`);
    const r = JSON.parse(sluzba(`SELECT public.avp_propose_identity()::text;`));
    expect(r.vozidla).toMatchObject({ objektu: 1, navrzeno: 1 });
    expect(r.ridici).toMatchObject({ objektu: 1, navrzeno: 1 });
    expect(r.cipy).toMatchObject({ kandidatu: 0 }); // žádná karta ještě není potvrzená
    expect(sluzba(`SELECT count(*) FROM public.twin_entities;`)).toBe(dvojcat);
    expect(ref("karta:5", "primary_id")).toMatchObject({ twin: V5, state: "proposed", proposed_by: "rule:signals:vehicle_machine_plate" });
    expect(Number(ref("karta:5", "primary_id").confidence)).toBe(0.5);
    expect(ref("karta:6", "primary_id")).toMatchObject({ twin: D6, state: "proposed" });
  });

  it("bez potvrzené vazby se nepromítne nic; výdej bez vozidla i čipu se jen spočítá", () => {
    const r = sluzbaJson(`SELECT public.avp_project_fuelings()::text;`);
    expect(r).toMatchObject({ prijato: 0, nove: 0, ceka_na_vazbu: 4, bez_vozidla: 1 });
  });

  it("potvrzená karta: litry nese jen PLATNÁ verze řetězu; čip se navrhne na dvojče karty", () => {
    potvrdit("karta:5", "primary_id");
    potvrdit("karta:6", "primary_id");

    const n = JSON.parse(sluzba(`SELECT public.avp_propose_identity()::text;`));
    expect(n.cipy).toMatchObject({ kandidatu: 2, navrzeno: 2 });
    expect(ref(`cip:${CIP_VOZU}`, "field_identity")).toMatchObject({ twin: V5, proposed_by: "rule:avp-cip-karta" });
    expect(Number(ref(`cip:${CIP_VOZU}`, "field_identity").confidence)).toBe(0.7);
    // Kolize klíčů: čip „5" patří k ŘIDIČI (karta 6), karta 5 je vozidlo — dva různé klíče.
    expect(ref("cip:5", "field_identity").twin).toBe(D6);
    expect(ref("karta:5", "primary_id").twin).toBe(V5);

    const r = sluzbaJson(`SELECT public.avp_project_fuelings()::text;`);
    expect(r).toMatchObject({ nove: 3, jiny_druh: 0, ceka_na_vazbu: 1 }); // 104 čeká na vazbu čipu
    expect(udalost("101").attrs).toEqual({ stav: "nahrazeno" });
    expect(udalost("102")).toMatchObject({ twin: V5, rel: D6, attrs: { liters: 55, stav: "platne" } });
    expect(udalost("103").attrs).toEqual({ stav: "skryto" });
    expect(soucet()).toBe("55");
  });

  it("výdej bez karty vozidla jde přes čip — k času výdeje; řidič přes svůj čip, ne přes kartu 5", () => {
    potvrdit(`cip:${CIP_VOZU}`, "field_identity");
    potvrdit("cip:5", "field_identity");

    expect(sluzbaJson(`SELECT public.avp_project_fuelings()::text;`)).toMatchObject({ nove: 1, ceka_na_vazbu: 0 });
    expect(udalost("104")).toMatchObject({ twin: V5, rel: D6, attrs: { liters: 30, stav: "platne", vozidlo_z_cipu: true } });
    expect(soucet()).toBe("85");
  });

  it("pozdní oprava: rodič se znovu pošle a jeho litry se v součtu vynulují", () => {
    // Staré výdeje „synchronizované" včera — v okně je jen nová oprava 106.
    psqlMultiline(`${HEADER}
UPDATE public.source_catalog_rows SET synced_at = now() - interval '1 day'
 WHERE source_slug = 'avp-portal' AND kind = 'fueling';
INSERT INTO public.source_catalog_rows (source_slug, kind, external_id, occurred_at, fields, synced_at) VALUES
  ${vydej("106", `'vehicle_id',5,'driver_id',6,'liters',56,'parent_id',102`)};`);

    expect(sluzbaJson(`SELECT public.avp_project_fuelings()::text;`)).toMatchObject({ nove: 1, zmenene: 1 });
    expect(udalost("102").attrs).toEqual({ stav: "nahrazeno" });
    expect(soucet()).toBe("86");
    // A další takt beze změn nic nezapíše.
    expect(sluzbaJson(`SELECT public.avp_project_fuelings()::text;`)).toMatchObject({ nove: 0, zmenene: 0 });
  });

  it("adaptéry smí volat jen zdroj", () => {
    expect(zkusJako(ADMIN, "SELECT public.avp_project_fuelings()")).toMatch(/permission denied/);
    expect(zkusJako(ADMIN, "SELECT public.avp_propose_identity()")).toMatch(/permission denied/);
  });
});
