import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline, psqlQuery } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * Druh entity v klíči vazby identity (2026-09-27).
 *
 * ⛔ PROČ: vazba (twin_external_refs) byla jedinečná jen v (source, source_key,
 * ref_kind). Zdroj, který čísluje dva druhy objektů zvlášť (T-cars vozidloId ×
 * osobaId, Eurowag monitoredObjectId × driver id), pak pod holým číslem
 * kolidoval: potvrzené VOZIDLO 5 „zabralo" klíč OSOBY 5, návrh pro osobu se
 * tiše přeskočil jako konflikt, resolve u jízdy vrátil za řidiče vozidlo
 * a twin_upsert_entity_audited by osobě 5 přepsal jméno vozidla 5.
 *
 * Měří se nad skutečnou DB (kolize „vozidlo 5 × osoba 5" projde SPRÁVNĚ):
 *   • zakládání: vozidlo 5 a osoba 5 = dvě dvojčata, žádné přepsání;
 *   • resolve: s druhem správné dvojče, bez druhu při dvou druzích NAHLAS;
 *   • návrh a potvrzení: osoba 5 si klíč nebere od vozidla 5; v rámci druhu
 *     pojistka platí dál (potvrzení druhé osoby 5 spadne);
 *   • druh vazby je ODVOZENÝ — ručně zadaný se přepíše druhem dvojčete;
 *   • změna druhu dvojčete, která by udělala dvojí vazbu, spadne nahlas.
 */
const dbAvailable = isPgReachable();
const HEADER = "\\set ON_ERROR_STOP on\n";
const ADMIN = "99999999-9999-4999-8999-999999999901";
const ZDROJ = "zz-druh-zdroj";

const sluzba = (sql: string) =>
  psqlQuery(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true) IS NOT NULL AND true; ${sql}`)
    .trim()
    .split("\n")
    .pop() ?? "";

/** Pokus, který MÁ selhat — vrací text chyby, nebo 'PROSLO'. */
const zkus = (sql: string, sub?: string): string => {
  const kdo = sub
    ? `SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"${sub}"}', true);`
    : `SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);`;
  try {
    psqlMultiline(`${HEADER}BEGIN;
${kdo}
${sql};
ROLLBACK;`);
    return "PROSLO";
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    return String(e.stderr ?? e.message ?? err);
  }
};

/** Čtení pod správcem (fronta ratifikace je jen pro admin/staff) — poslední řádek. */
const jakoSpravceCti = (sql: string) =>
  psqlQuery(`SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"${ADMIN}"}', true) IS NOT NULL AND true; ${sql}`)
    .trim()
    .split("\n")
    .pop() ?? "";

const jakoSpravce = (sql: string) =>
  psqlMultiline(`${HEADER}BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"${ADMIN}"}', true);
SELECT (${sql})::text;
COMMIT;`);

const upsert = (druh: string, klic: string, jmeno: string) =>
  JSON.parse(
    sluzba(`SELECT public.twin_upsert_entity_audited('${druh}', '${ZDROJ}', '${klic}', '${jmeno}')::text;`),
  ) as { twin_id: string };

const resolve = (klic: string, druh: string | null) =>
  sluzba(`SELECT coalesce(public.twin_identity_resolve('${ZDROJ}', '${klic}', 'primary_id', NULL,
                          ${druh ? `'${druh}'` : "NULL"})::text, 'NULL');`);

let VUZ5 = "";
let OSOBA5 = "";

beforeAll(async () => {
  await reportTestCapabilities("druh entity v klíči vazby");
  if (!dbAvailable) return;
  psqlMultiline(`${HEADER}
DELETE FROM public.twin_entities WHERE id IN (SELECT twin_id FROM public.twin_external_refs WHERE source = '${ZDROJ}');
DELETE FROM public.twin_entities WHERE label LIKE 'zz-druh %';
INSERT INTO aisha_auth.users (id, email) VALUES ('${ADMIN}', 'druh-spravce@test.local') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (user_id, email) VALUES ('${ADMIN}', 'druh-spravce@test.local') ON CONFLICT (user_id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin') ON CONFLICT DO NOTHING;`);
});

describe.skipIf(!dbAvailable)("druh entity v klíči vazby identity", () => {
  it("zakládání: vozidlo 5 a osoba 5 téhož zdroje jsou DVĚ dvojčata — osoba vozidlu nic nepřepíše", () => {
    VUZ5 = upsert("vehicle", "5", "zz-druh vůz 5").twin_id;
    OSOBA5 = upsert("person", "5", "zz-druh osoba 5").twin_id;
    expect(OSOBA5).not.toBe(VUZ5);
    expect(sluzba(`SELECT label FROM public.twin_entities WHERE id = '${VUZ5}';`)).toBe("zz-druh vůz 5");
    // Opakované založení najde své dvojče v rámci druhu (idempotence).
    expect(upsert("vehicle", "5", "zz-druh vůz 5").twin_id).toBe(VUZ5);
  });

  it("resolve: s druhem vrátí správné dvojče, bez druhu při dvou druzích selže NAHLAS", () => {
    expect(resolve("5", "vehicle")).toBe(VUZ5);
    expect(resolve("5", "person")).toBe(OSOBA5);
    expect(zkus(`SELECT public.twin_identity_resolve('${ZDROJ}', '5')`)).toMatch(/patří 2 druhům entit — předej p_entity_type/);
    // Jediný druh pod klíčem: bez druhu dál funguje jako dřív.
    const vuz6 = upsert("vehicle", "6", "zz-druh vůz 6").twin_id;
    expect(resolve("6", null)).toBe(vuz6);
  });

  it("návrh a potvrzení: osoba si klíč od vozidla nebere, v rámci druhu pojistka platí", () => {
    const osoba7 = upsert("person", "zz-7-cizi", "zz-druh osoba 7").twin_id;
    // Návrh klíče vozidla 6 pro OSOBU = nová vazba jiného druhu, ne konflikt.
    const n1 = JSON.parse(
      sluzba(`SELECT public.twin_identity_propose_binding('${osoba7}', '${ZDROJ}', '6', 'primary_id', 'test')::text;`),
    );
    expect(n1).toMatchObject({ state: "proposed", conflict: false });
    jakoSpravce(`public.twin_identity_confirm_binding('${n1.ref_id}')`);
    expect(resolve("6", "person")).toBe(osoba7);

    // Druhá osoba s klíčem 5, který už potvrzeně drží OSOBA 5 → konflikt v rámci druhu.
    const osoba8 = upsert("person", "zz-8-cizi", "zz-druh osoba 8").twin_id;
    const n2 = JSON.parse(
      sluzba(`SELECT public.twin_identity_propose_binding('${osoba8}', '${ZDROJ}', '5', 'primary_id', 'test')::text;`),
    );
    expect(n2).toMatchObject({ state: "proposed", conflict: true });
    expect(zkus(`SELECT public.twin_identity_confirm_binding('${n2.ref_id}')`, ADMIN)).toMatch(
      /key already confirmed for another twin/,
    );
    // Fronta ratifikace ukazuje konflikt jen u téhož druhu.
    const fronta = JSON.parse(jakoSpravceCti(`SELECT public.twin_identity_list_unmatched(NULL, 500)::text;`)) as Array<{
      ref_id: string;
      conflict: boolean;
    }>;
    expect(fronta.find((i) => i.ref_id === n2.ref_id)?.conflict).toBe(true);
  });

  it("druh vazby je ODVOZENÝ z dvojčete — ručně zadaný se přepíše", () => {
    const druh = sluzba(`WITH x AS (
        INSERT INTO public.twin_external_refs (twin_id, source, source_key, ref_kind, state, proposed_by, entity_type)
        VALUES ('${VUZ5}', '${ZDROJ}', 'zz-rucne', 'field_identity', 'proposed', 'test', 'nesmysl')
        RETURNING entity_type) SELECT entity_type FROM x;`);
    expect(druh).toBe("vehicle");
  });

  it("změna druhu dvojčete, která by udělala dvojí potvrzenou vazbu, spadne nahlas", () => {
    // Vůz 5 → person by pod klíčem 5 potkal potvrzenou OSOBU 5.
    expect(zkus(`UPDATE public.twin_entities SET entity_type = 'person' WHERE id = '${VUZ5}'`)).toMatch(
      /uq_twin_external_refs_active_owner/,
    );
    expect(sluzba(`SELECT entity_type FROM public.twin_entities WHERE id = '${VUZ5}';`)).toBe("vehicle");
  });

  it("v rámci druhu jedinečnost platí dál (index, ne jen funkce)", () => {
    expect(
      zkus(`INSERT INTO public.twin_external_refs (twin_id, source, source_key, ref_kind, state, proposed_by, confirmed_at)
            VALUES ('${upsert("vehicle", "zz-9", "zz-druh vůz 9").twin_id}', '${ZDROJ}', '5', 'primary_id', 'confirmed', 'test', now())`),
    ).toMatch(/uq_twin_external_refs_active_owner/);
  });
});
