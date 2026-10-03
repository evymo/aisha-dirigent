import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { psqlQuery } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * HR „LIDÉ A ÚČTY" — real-DB runtime test (throwaway PG přes `npm run test:db`).
 *
 * ⭐ Zadání majitele (2026-09-23): „účty v KC propojujeme s entitami z twinverse".
 *
 * Tvrdí se:
 *   · přiřazení = POTVRZENÁ účtová vazba (twin_for_account ji vidí), confirmed_by = HR;
 *   · účet smí PŘEJÍT k jiné osobě — staré vazbě skončí platnost, historie zůstane;
 *   · osobu s JINÝM účtem přiřazení NEPŘEBERE (přebývající přístup nikdo nenahlásí);
 *   · odvázání ukončí platnost okamžitě a nesahá na vazby zdrojů;
 *   · bez role správce se nezapíše NIC;
 *   · pracovní seznam hledá ve jménu i v klíči zdroje a řekne, že je uříznutý.
 * Každý případ běží ve VRÁCENÉ transakci — v DB nic nezůstane.
 */

const dbAvailable = isPgReachable();
const ZDROJ = `hr-test-${process.pid}-${Date.now()}`;
const ZNACKA = "@@ODPOVED@@";

beforeAll(async () => {
  await reportTestCapabilities("HR lidé a účty");
});

function admin(): string {
  const a = psqlQuery(`select user_id from public.user_roles where role in ('admin','staff') order by user_id limit 1`);
  expect(a, "fixture: no admin/staff user seeded").toMatch(/^[0-9a-f-]{36}$/);
  return a;
}

/**
 * Jedna vrácená transakce: `priprava` jako vlastník (fixtures), pak `kroky` jako
 * přihlášený `sub` (role authenticated), nakonec `zaver` zase jako vlastník.
 */
function transakce(sub: string, priprava: string, kroky: string, zaver: string): unknown {
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

/** Uživatel + profil (účet, který se „jednou přihlásil") a dvě osoby. */
function priprava(adminId: string, ucet: string, dalsi?: string): string {
  const ucty = [ucet, dalsi].filter(Boolean) as string[];
  return (
    ucty.map((u, i) =>
      `insert into aisha_auth.users (id, email) values ('${u}', 'hr-${i}-${u.slice(0, 8)}@test.local'); ` +
      // Profil založí spouštěč nad aisha_auth.users sám — tady se jen pojmenuje.
      `insert into public.profiles (user_id, email, display_name) values ('${u}', 'hr-${i}-${u.slice(0, 8)}@test.local', 'Účet ${i}') ` +
      `on conflict (user_id) do update set display_name = excluded.display_name, email = excluded.email; `,
    ).join("") +
    `select set_config('request.jwt.claim.sub', '${adminId}', true); ` +
    `select set_config('hr.a', public.twin_upsert_entity_audited('person', '${ZDROJ}', 'A-1', 'Jan Automatický')->>'twin_id', true); ` +
    `select set_config('hr.b', public.twin_upsert_entity_audited('person', '${ZDROJ}', 'WD-4711', 'KOŽUŠNÍK Test')->>'twin_id', true); `
  );
}

const A = `current_setting('hr.a')::uuid`;
const B = `current_setting('hr.b')::uuid`;
const zachyt = (volani: string) =>
  `do $$ begin perform ${volani}; perform set_config('hr.chyba', 'NEPADLO', true); ` +
  `exception when others then perform set_config('hr.chyba', SQLERRM, true); end $$; `;

describe("HR lidé a účty", () => {
  it.skipIf(!dbAvailable)("přiřazení = potvrzená vazba; účet přejde k jiné osobě s historií", () => {
    const hr = admin();
    const u = randomUUID();
    const v = transakce(
      hr,
      priprava(hr, u),
      `select set_config('hr.r1', public.hr_prirad_ucet_admin('${u}', ${A})::text, true); ` +
        `select set_config('hr.r2', public.hr_prirad_ucet_admin('${u}', ${B})::text, true); `,
      `jsonb_build_object(
         'r1', current_setting('hr.r1')::jsonb,
         'r2', current_setting('hr.r2')::jsonb,
         'osoba_ted', (select public.twin_for_account('${u}'))::text = ${B}::text,
         'a_ukoncena', (select count(*) from public.twin_external_refs r where r.twin_id = ${A}
                          and r.ref_kind = 'account' and r.source_key = '${u}'
                          and r.state = 'confirmed' and r.valid_to is not null),
         'b_potvrdil_hr', (select r.confirmed_by::text from public.twin_external_refs r where r.twin_id = ${B}
                          and r.ref_kind = 'account' and r.state = 'confirmed' and r.valid_to is null) = '${hr}',
         'predchozi_je_a', (current_setting('hr.r2')::jsonb->>'predchozi_twin_id') = ${A}::text)`,
    ) as Record<string, unknown>;
    expect(v.osoba_ted).toBe(true);
    expect(v.a_ukoncena).toBe(1);
    expect(v.b_potvrdil_hr).toBe(true);
    expect(v.predchozi_je_a).toBe(true);
  });

  it.skipIf(!dbAvailable)("⛔ osobu s JINÝM účtem nepřebere; nic se nezmění", () => {
    const hr = admin();
    const u1 = randomUUID();
    const u2 = randomUUID();
    const v = transakce(
      hr,
      priprava(hr, u1, u2),
      `select public.hr_prirad_ucet_admin('${u1}', ${B}); ` + zachyt(`public.hr_prirad_ucet_admin('${u2}', ${B})`),
      `jsonb_build_object('chyba', current_setting('hr.chyba'),
         'b_ma', (select r.source_key from public.twin_external_refs r where r.twin_id = ${B}
                   and r.ref_kind = 'account' and r.state = 'confirmed' and r.valid_to is null),
         'u2_nic', (select count(*) from public.twin_external_refs r where r.source_key = '${u2}'
                     and r.ref_kind = 'account' and r.state = 'confirmed'))`,
    ) as Record<string, unknown>;
    expect(v.chyba).toContain("person_has_other_account");
    expect(v.b_ma).toBe(u1);
    expect(v.u2_nic).toBe(0);
  });

  it.skipIf(!dbAvailable)("odvázání ukončí platnost hned a vazbu zdroje nepustí", () => {
    const hr = admin();
    const u = randomUUID();
    const v = transakce(
      hr,
      priprava(hr, u),
      `select set_config('hr.ref', public.hr_prirad_ucet_admin('${u}', ${B})->>'ref_id', true); ` +
        `select public.hr_odvaz_ucet_admin(current_setting('hr.ref')::uuid); ` +
        zachyt(`public.hr_odvaz_ucet_admin((select r.id from public.twin_external_refs r where r.twin_id = ${B} and r.ref_kind <> 'account' limit 1))`),
      `jsonb_build_object('osoba', (select public.twin_for_account('${u}')),
         'zdroj_chyba', current_setting('hr.chyba'),
         'zdroj_plati', (select count(*) from public.twin_external_refs r where r.twin_id = ${B}
                          and r.ref_kind <> 'account' and r.state = 'confirmed' and r.valid_to is null))`,
    ) as Record<string, unknown>;
    expect(v.osoba).toBeNull();
    expect(v.zdroj_chyba).toContain("not an account binding");
    expect(v.zdroj_plati).toBe(1);
  });

  it.skipIf(!dbAvailable)("⛔ bez role správce se nezapíše nic", () => {
    const hr = admin();
    const u = randomUUID();
    const v = transakce(
      u,
      priprava(hr, u),
      zachyt(`public.hr_prirad_ucet_admin('${u}', current_setting('hr.b')::uuid)`),
      `jsonb_build_object('chyba', current_setting('hr.chyba'),
         'vazeb', (select count(*) from public.twin_external_refs r where r.source_key = '${u}' and r.ref_kind = 'account'))`,
    ) as Record<string, unknown>;
    expect(v.chyba).toContain("Unauthorized");
    expect(v.vazeb).toBe(0);
  });

  it.skipIf(!dbAvailable)("seznamy: hledání ve jménu i klíči zdroje, uříznutí je vidět, účet ukáže osobu", () => {
    const hr = admin();
    const u = randomUUID();
    const v = transakce(
      hr,
      priprava(hr, u),
      `select public.hr_prirad_ucet_admin('${u}', ${A}); ` +
        // Třetí osoba bez účtu: uříznutí se musí dát změřit i na prázdné DB.
        `select public.twin_upsert_entity_audited('person', '${ZDROJ}', 'C-1', 'Třetí Osoba'); ` +
        `select set_config('hr.jmeno', public.twin_accounts_missing(NULL, 50, 'KOŽUŠNÍK Test')::text, true); ` +
        `select set_config('hr.klic', public.twin_accounts_missing(NULL, 50, 'WD-4711')::text, true); ` +
        `select set_config('hr.vzor', public.twin_accounts_missing(NULL, 50, '%')::text, true); ` +
        `select set_config('hr.ucty', public.hr_ucty_admin('Účet 0', 10)::text, true); ` +
        `select set_config('hr.limit', public.twin_accounts_missing(NULL, 1, NULL)::text, true); `,
      `jsonb_build_object(
         'jmeno', current_setting('hr.jmeno')::jsonb, 'klic', current_setting('hr.klic')::jsonb,
         'vzor', current_setting('hr.vzor')::jsonb, 'ucty', current_setting('hr.ucty')::jsonb,
         'limit', current_setting('hr.limit')::jsonb, 'b', ${B}::text, 'a', ${A}::text)`,
    ) as {
      jmeno: { items: { twin_id: string; kroky: { celkem: number; ceka: number } }[] };
      klic: { items: { twin_id: string }[] };
      vzor: { items: unknown[] };
      ucty: { items: { user_id: string; osoba: { twin_id: string } | null }[] };
      limit: { count: number; limitovano: boolean };
      a: string;
      b: string;
    };
    expect(v.jmeno.items.map((i) => i.twin_id)).toContain(v.b);
    expect(v.jmeno.items.find((i) => i.twin_id === v.b)?.kroky).toEqual({ celkem: 0, ceka: 0 });
    expect(v.klic.items.map((i) => i.twin_id)).toContain(v.b);
    // `%` v zadání je znak, ne zástupný vzor — nesmí vrátit všechno.
    expect(v.vzor.items).toEqual([]);
    // Osoba s účtem v seznamu „bez účtu" není.
    expect(v.jmeno.items.map((i) => i.twin_id)).not.toContain(v.a);
    expect(v.ucty.items.find((i) => i.user_id === u)?.osoba?.twin_id).toBe(v.a);
    expect(v.limit.count).toBe(1);
    expect(v.limit.limitovano).toBe(true);
  });

  it.skipIf(!dbAvailable)("nabídka druhů je z dat a přiřazení sníží „bez účtu“ přesně o jednu", () => {
    const hr = admin();
    const u = randomUUID();
    const v = transakce(
      hr,
      priprava(hr, u),
      `select set_config('hr.pred', public.hr_druhy_osob_admin()::text, true); ` +
        `select public.hr_prirad_ucet_admin('${u}', ${A}); ` +
        `select set_config('hr.po', public.hr_druhy_osob_admin()::text, true); `,
      `jsonb_build_object('pred', current_setting('hr.pred')::jsonb, 'po', current_setting('hr.po')::jsonb)`,
    ) as { pred: { items: { entity_type: string; bez_uctu: number; celkem: number }[] }; po: { items: { entity_type: string; bez_uctu: number; celkem: number }[] } };
    const osoba = (x: typeof v.pred) => x.items.find((i) => i.entity_type === "person");
    expect(osoba(v.pred)?.celkem).toBeGreaterThanOrEqual(2);
    expect(osoba(v.po)?.celkem).toBe(osoba(v.pred)?.celkem);
    expect(osoba(v.po)?.bez_uctu).toBe((osoba(v.pred)?.bez_uctu ?? 0) - 1);
  });
});
