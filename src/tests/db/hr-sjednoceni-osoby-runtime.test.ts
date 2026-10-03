import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { psqlQuery } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * HR SJEDNOCENÍ OSOBY — real-DB runtime test (throwaway PG přes `npm run test:db`).
 *
 * ⭐ Rozhodnutí majitele (2026-09-23): HR spojuje nález s člověkem (identita),
 * kokpit ingestu navrhuje. Naměřeno týž den: 1 487 twinů `driver` na ~47 řidičů.
 *
 * Tvrdí se:
 *   · náhled NIC nezapíše;
 *   · sjednocení převede vazby, přepojí ČEKAJÍCÍ úkoly (hotové ne), úlomky archivuje,
 *     zamkne jméno — a INGEST SE UČÍ: upsert s klíčem úlomku trefí kanon a jméno nepřepíše;
 *   · duplicitní návrh se nezdvojí (ukončí se);
 *   · odmítne úlomek s účtem, jiný druh, kanon mezi úlomky, ostrý běh bez důvodu, bez role;
 *   · vrácení vše obnoví a podruhé se odmítne.
 * Každý případ běží ve VRÁCENÉ transakci.
 */

const dbAvailable = isPgReachable();
const Z = `hr-sj-${process.pid}-${Date.now()}`;
const ZNACKA = "@@ODPOVED@@";

beforeAll(async () => {
  await reportTestCapabilities("HR sjednocení osoby");
});

function admin(): string {
  const a = psqlQuery(`select user_id from public.user_roles where role in ('admin','staff') order by user_id limit 1`);
  expect(a, "fixture: no admin/staff user seeded").toMatch(/^[0-9a-f-]{36}$/);
  return a;
}

function transakce(sub: string, priprava: string, kroky: string, zaver: string): Record<string, unknown> {
  const out = psqlQuery(
    `begin; ${priprava} ` +
      `select set_config('request.jwt.claims', '{"sub":"${sub}","role":"authenticated"}', true); ` +
      `select set_config('request.jwt.claim.sub', '${sub}', true); ` +
      `set local role authenticated; ${kroky} ` +
      `reset role; select '${ZNACKA}' || (${zaver})::text; rollback;`,
  );
  const radek = out.split("\n").map((r) => r.trim()).find((r) => r.startsWith(ZNACKA));
  if (!radek) throw new Error(`ve výstupu psql chybí odpověď: ${out.slice(0, 300)}`);
  return JSON.parse(radek.slice(ZNACKA.length));
}

/** Kanon + dva úlomky (driver), návrhy, dávka se třemi kroky. */
function priprava(hr: string): string {
  const up = (klic: string, jmeno: string, druh = "driver") =>
    `public.twin_upsert_entity_audited('${druh}', '${Z}', '${klic}', '${jmeno}')->>'twin_id'`;
  return (
    `select set_config('request.jwt.claim.sub', '${hr}', true); ` +
    `select set_config('sj.k', ${up("K-1", "KOŽUŠNÍK Petr")}, true); ` +
    `select set_config('sj.f1', ${up("K-2", "p. Kožušník")}, true); ` +
    `select set_config('sj.f2', ${up("K-3", "Kozusnik 1AB2345")}, true); ` +
    `select set_config('sj.jiny', ${up("P-1", "Někdo jiný", "person")}, true); ` +
    // Týž návrh u kanonu i u OBOU úlomků → u úlomků se jen ukončí, kanon ho má jednou.
    `insert into public.twin_external_refs (twin_id, source, source_key, ref_kind, state, proposed_by) values ` +
    `(current_setting('sj.k')::uuid, '${Z}', 'kozusnik', 'driver_name', 'proposed', 'test'), ` +
    `(current_setting('sj.f1')::uuid, '${Z}', 'kozusnik', 'driver_name', 'proposed', 'test'), ` +
    `(current_setting('sj.f2')::uuid, '${Z}', 'kozusnik', 'driver_name', 'proposed', 'test'), ` +
    `(current_setting('sj.f2')::uuid, '${Z}', '1AB2345', 'vehicle_plate', 'proposed', 'test'), ` +
    // Návrh, který mají JEN oba úlomky (kanon ne) → přesune se jeden, druhý se ukončí.
    `(current_setting('sj.f1')::uuid, '${Z}', 'jen-ulomky', 'driver_name', 'proposed', 'test'), ` +
    `(current_setting('sj.f2')::uuid, '${Z}', 'jen-ulomky', 'driver_name', 'proposed', 'test'); ` +
    `with b as (insert into public.production_batches default values returning id) ` +
    `select set_config('sj.b', (select id from b)::text, true); ` +
    `insert into public.production_workflow_steps (batch_id, step_name, step_order, status, input_data) values ` +
    `(current_setting('sj.b')::uuid, 'ceka-f1', 1, 'pending', jsonb_build_object('authorized_twin_id', current_setting('sj.f1'))), ` +
    `(current_setting('sj.b')::uuid, 'hotovo-f1', 2, 'completed', jsonb_build_object('authorized_twin_id', current_setting('sj.f1'))), ` +
    `(current_setting('sj.b')::uuid, 'ceka-f2', 3, 'pending', jsonb_build_object('authorized_twin_id', current_setting('sj.f2'))); `
  );
}

const K = `current_setting('sj.k')::uuid`;
const F1 = `current_setting('sj.f1')::uuid`;
const F2 = `current_setting('sj.f2')::uuid`;
const ULOMKY = `array[${F1}, ${F2}]`;
const krok = (jmeno: string) =>
  `(select s.input_data->>'authorized_twin_id' from public.production_workflow_steps s where s.batch_id = current_setting('sj.b')::uuid and s.step_name = '${jmeno}')`;

describe("HR sjednocení osoby", () => {
  it.skipIf(!dbAvailable)("náhled spočítá a NIC nezapíše", () => {
    const hr = admin();
    const v = transakce(
      hr,
      priprava(hr),
      `select set_config('sj.r', public.hr_sjednot_osobu_admin(${K}, ${ULOMKY})::text, true); `,
      `jsonb_build_object('r', current_setting('sj.r')::jsonb,
         'archivovano', (select count(*) from public.twin_entities where id = any(${ULOMKY}) and status = 'archived'),
         'ceka_f1', ${krok("ceka-f1")} = ${F1}::text)`,
    ) as { r: { ok: boolean; dry_run: boolean; pocty: Record<string, number> }; archivovano: number; ceka_f1: boolean };
    expect(v.r.ok).toBe(true);
    expect(v.r.dry_run).toBe(true);
    expect(v.r.pocty).toMatchObject({ zaznamu_archivovat: 2, kroku_prepojit: 2, kroku_hotovych_zustava: 1, vazeb_ukoncit: 3 });
    expect(v.r.pocty.vazeb_presunout).toBe(4); // primární K-2, K-3 + SPZ + jeden „jen-ulomky"
    expect(v.archivovano).toBe(0);
    expect(v.ceka_f1).toBe(true);
  });

  it.skipIf(!dbAvailable)("sjednocení: vazby, čekající úkoly, archiv, zámek jména — a ingest se učí", () => {
    const hr = admin();
    const v = transakce(
      hr,
      priprava(hr),
      `select set_config('sj.r', public.hr_sjednot_osobu_admin(${K}, ${ULOMKY}, 'test sjednocení', false)::text, true); ` +
        // Další doručení ingestu s klíčem úlomku, novým jménem a CELÝMI novými metadaty.
        `select set_config('sj.u', public.twin_upsert_entity_audited('driver', '${Z}', 'K-2', 'jiný zápis', NULL, '{"x":1}'::jsonb)->>'twin_id', true); `,
      `jsonb_build_object('r', current_setting('sj.r')::jsonb,
         'archivovano', (select count(*) from public.twin_entities where id = any(${ULOMKY}) and status = 'archived'
                          and metadata->>'archivovano_rozhodnutim' = current_setting('sj.r')::jsonb->>'decision_id'),
         'ceka_f1_na_k', ${krok("ceka-f1")} = ${K}::text,
         'ceka_f2_na_k', ${krok("ceka-f2")} = ${K}::text,
         'hotovo_zustava', ${krok("hotovo-f1")} = ${F1}::text,
         'upsert_trefil_kanon', current_setting('sj.u') = ${K}::text,
         'jmeno', (select label from public.twin_entities where id = ${K}),
         'meta_x', (select metadata->>'x' from public.twin_entities where id = ${K}),
         'zamek', (select metadata ? 'label_hr' from public.twin_entities where id = ${K}),
         'navrh_kozusnik_u_k', (select count(*) from public.twin_external_refs where twin_id = ${K} and source_key = 'kozusnik' and valid_to is null),
         'spz_u_k', (select count(*) from public.twin_external_refs where twin_id = ${K} and source_key = '1AB2345' and valid_to is null),
         'jen_ulomky_u_k', (select count(*) from public.twin_external_refs where twin_id = ${K} and source_key = 'jen-ulomky' and valid_to is null))`,
    );
    expect((v.r as { ok: boolean }).ok).toBe(true);
    expect(v.archivovano).toBe(2);
    expect(v.ceka_f1_na_k).toBe(true);
    expect(v.ceka_f2_na_k).toBe(true);
    expect(v.hotovo_zustava).toBe(true);
    expect(v.upsert_trefil_kanon).toBe(true);
    expect(v.jmeno).toBe("KOŽUŠNÍK Petr");
    expect(v.meta_x).toBe("1");
    expect(v.zamek).toBe(true);
    expect(v.navrh_kozusnik_u_k).toBe(1);
    expect(v.spz_u_k).toBe(1);
    expect(v.jen_ulomky_u_k).toBe(1);
  });

  it.skipIf(!dbAvailable)("⛔ odmítne: úlomek s účtem, jiný druh, kanon mezi úlomky, ostrý běh bez důvodu", () => {
    const hr = admin();
    const u = randomUUID();
    const v = transakce(
      hr,
      priprava(hr) +
        `insert into aisha_auth.users (id, email) values ('${u}', 'sj-${u.slice(0, 8)}@test.local'); `,
      `select public.hr_prirad_ucet_admin('${u}', ${F1}); ` +
        `select set_config('sj.ucet', public.hr_sjednot_osobu_admin(${K}, ${ULOMKY})::text, true); ` +
        `select set_config('sj.druh', public.hr_sjednot_osobu_admin(${K}, array[current_setting('sj.jiny')::uuid])::text, true); ` +
        `select set_config('sj.kanon', public.hr_sjednot_osobu_admin(${K}, array[${K}])::text, true); ` +
        `select set_config('sj.duvod', public.hr_sjednot_osobu_admin(${K}, array[${F2}], '  ', false)::text, true); `,
      `jsonb_build_object('ucet', current_setting('sj.ucet')::jsonb->>'error',
         'druh', current_setting('sj.druh')::jsonb->>'error',
         'kanon', current_setting('sj.kanon')::jsonb->>'error',
         'duvod', current_setting('sj.duvod')::jsonb->>'error',
         'nic_archivovano', (select count(*) from public.twin_entities where id = any(${ULOMKY}) and status = 'archived') = 0)`,
    );
    expect(v.ucet).toBe("ulomek_ma_ucet");
    expect(v.druh).toBe("ulomek_neni_stejneho_druhu_nebo_aktivni");
    expect(v.kanon).toBe("kanon_mezi_ulomky");
    expect(v.duvod).toBe("duvod_je_povinny");
    expect(v.nic_archivovano).toBe(true);
  });

  it.skipIf(!dbAvailable)("vrácení vše obnoví, odemkne jméno a podruhé se odmítne", () => {
    const hr = admin();
    const v = transakce(
      hr,
      priprava(hr),
      `select set_config('sj.d', public.hr_sjednot_osobu_admin(${K}, ${ULOMKY}, 'test', false)->>'decision_id', true); ` +
        // Přehled rozhodnutí (odtud UI nabízí „Vrátit") — PŘED vrácením vratné.
        `select set_config('sj.pred', (select x from jsonb_array_elements(public.get_decisions_admin(50, 'twin_decision')->'items') x ` +
        `where x->>'decision_id' = current_setting('sj.d'))::text, true); ` +
        `select set_config('sj.nahled', public.revert_twin_decision_admin(current_setting('sj.d')::uuid, 'omyl', true)::text, true); ` +
        `select set_config('sj.zpet', public.revert_twin_decision_admin(current_setting('sj.d')::uuid, 'omyl', false)::text, true); ` +
        `select set_config('sj.znovu', public.revert_twin_decision_admin(current_setting('sj.d')::uuid, 'omyl', false)::text, true); ` +
        `select set_config('sj.po', (select x from jsonb_array_elements(public.get_decisions_admin(50, 'twin_decision')->'items') x ` +
        `where x->>'decision_id' = current_setting('sj.d'))::text, true); `,
      `jsonb_build_object('nahled', current_setting('sj.nahled')::jsonb, 'zpet', current_setting('sj.zpet')::jsonb,
         'pred', current_setting('sj.pred')::jsonb, 'po', current_setting('sj.po')::jsonb,
         'znovu', current_setting('sj.znovu')::jsonb->>'error',
         'aktivni', (select count(*) from public.twin_entities where id = any(${ULOMKY}) and status = 'active'),
         'primarni_f1', (select count(*) from public.twin_external_refs where twin_id = ${F1} and source_key = 'K-2' and valid_to is null),
         'ceka_f1', ${krok("ceka-f1")} = ${F1}::text,
         'ceka_f2', ${krok("ceka-f2")} = ${F2}::text,
         'zamek', (select metadata ? 'label_hr' from public.twin_entities where id = ${K}),
         'navrhy_obnoveny', (select count(*) from public.twin_external_refs where source_key = 'kozusnik' and state = 'proposed' and valid_to is null),
         'jen_ulomky_obnoveno', (select count(*) from public.twin_external_refs where source_key = 'jen-ulomky' and state = 'proposed' and valid_to is null
                                   and twin_id in (${F1}, ${F2})))`,
    ) as Record<string, unknown> & { nahled: Record<string, number>; zpet: Record<string, number> };
    expect(v.nahled.twinu).toBe(2);
    expect(v.nahled.kroku_zpet).toBe(2);
    expect(v.zpet.preskoceno_zmenene).toBe(0);
    expect(v.aktivni).toBe(2);
    expect(v.primarni_f1).toBe(1);
    expect(v.ceka_f1).toBe(true);
    expect(v.ceka_f2).toBe(true);
    expect(v.zamek).toBe(false);
    expect(v.navrhy_obnoveny).toBe(3);
    expect(v.jen_ulomky_obnoveno).toBe(2);
    expect(v.znovu).toBe("rozhodnutí už bylo vráceno");
    // UI nabízí „Vrátit" jen vratnému a nevrácenému rozhodnutí.
    const pred = v.pred as { vratne: boolean; vraceno: unknown; akce: string };
    const po = v.po as { vratne: boolean; vraceno: unknown };
    expect(pred.akce).toBe("twin.person_unified");
    expect(pred.vratne).toBe(true);
    expect(pred.vraceno).toBeNull();
    expect(po.vratne).toBe(false);
    expect(po.vraceno).not.toBeNull();
  });

  it.skipIf(!dbAvailable)("⛔ bez role správce nic", () => {
    const hr = admin();
    const u = randomUUID();
    const v = transakce(
      u,
      priprava(hr),
      `do $$ begin perform public.hr_sjednot_osobu_admin(current_setting('sj.k')::uuid, array[current_setting('sj.f1')::uuid], 'x', false); ` +
        `perform set_config('sj.chyba', 'NEPADLO', true); exception when others then perform set_config('sj.chyba', SQLERRM, true); end $$; `,
      `jsonb_build_object('chyba', current_setting('sj.chyba'),
         'archivovano', (select count(*) from public.twin_entities where id = ${F1} and status = 'archived'))`,
    );
    expect(v.chyba).toContain("Unauthorized");
    expect(v.archivovano).toBe(0);
  });
});
