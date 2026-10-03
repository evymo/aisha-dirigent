/**
 * F2-C nad SKUTEČNOU databází: dnešní rozvozy pro tablet (`get_kiosk_rozvozy`).
 *
 * Majitel 2026-09-29: výběr „podle řidiče“ i „podle vozidla“, jen naše doprava,
 * bez osobních údajů odběratele. Pinuje se: kdo RPC smí (jen účet zařízení s platným
 * průkazem), že ven jde JEN projekce `pole` z rozsahu, že vozidlo = tahač soupravy,
 * a že cizí doprava, jiný den i jiný krok zůstanou venku.
 */
import crypto, { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

const dbAvailable = isPgReachable();
const RUN = randomUUID().slice(0, 8);
const NASE = `NASE-${RUN}`;
const RIDIC = `Řidič ${RUN}`;

function sql(claims: string | null, q: string): string {
  const pre = claims === null ? "" : `\\o /dev/null\nSET request.jwt.claims = '${claims}';\n\\o\n`;
  return execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tAq"],
    { encoding: "utf8", input: `${pre}${q};`, env: { ...process.env, PGPASSWORD: PG_PASSWORD } },
  ).trim();
}
const svc = (q: string) => sql('{"role":"service_role"}', q);
/** Jako skutečný klient: claim + ROLE authenticated (granty platí). */
const jakoKlient = (uid: string, q: string, kid?: string) =>
  sql(null, `SET request.jwt.claims = '${JSON.stringify({ role: "authenticated", sub: uid, aisha_user_id: uid, ...(kid ? { device_kid: kid } : {}) })}';\nSET ROLE authenticated;\n${q}`);
const rozvozy = (uid: string, rezim: string | null, hodnota: string | null) =>
  JSON.parse(jakoKlient(uid, `select public.get_kiosk_rozvozy(${rezim ? `'${rezim}'` : "null"}, ${hodnota ? `'${hodnota}'` : "null"})`));

function schvalenyTablet(): string {
  const { publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const pubHex = Buffer.concat([Buffer.from([0x04]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]).toString("hex");
  const kid = `dev-${pubHex.slice(2, 18)}`;
  const ip = `10.${crypto.randomInt(1, 250)}.${crypto.randomInt(1, 250)}.${crypto.randomInt(1, 250)}`;
  svc(`select public.enrol_kiosk_device('${kid}', '${pubHex}', 'kiosk-${RUN}', '${ip}'::inet, null)`);
  svc(`select public.admin_set_knock_device_approval('${kid}', true)`);
  return sql(null, `select ucet_id from public.knock_device_credentials where kid = '${kid}'`);
}
/**
 * Dvojče a jeho párování s Webdispečinkem — tvar, který píše `wd_propose_identity`
 * (`webdispecink` / `primary_id`, řidič `ridic:<id>`, vozidlo `wd_car_id`) a potvrzuje člověk.
 */
function ridicWd(stav: "confirmed" | "proposed" = "confirmed", platnyDo: string | null = null, druh = "driver"): string {
  const twin = svc(`insert into public.twin_entities (entity_type, label) values ('${druh}', 'Řidič ${RUN}') returning id`);
  svc(`insert into public.twin_external_refs (twin_id, source, source_key, ref_kind, state, proposed_by, confirmed_at, valid_from, valid_to)
       values ('${twin}', 'webdispecink', 'ridic:${randomUUID()}', 'primary_id', '${stav}', 'test:${RUN}',
               ${stav === "confirmed" ? "now()" : "null"}, now() - interval '1 day', ${platnyDo ?? "null"})`);
  return twin;
}
/** Běh (nakládka + předání) s danými údaji předmětu, dnem a kódem kroku předání. */
function beh(predmet: Record<string, string>, den = "current_date", kod = "predani"): string {
  // Název běhu nese odběratele (subject_label „{odběratel} — {DL}“) — jako v produkci.
  const nazev = `${predmet.counterparty ?? "Test"} — DL`.replace(/'/g, "''");
  const batch = svc(`insert into public.production_batches (batch_code, product_name, production_date)
                     values ('expedice:${randomUUID().slice(0, 8)}-${RUN}', '${nazev}', ${den}) returning id`);
  const input = JSON.stringify({ dl_number: `DL-${randomUUID().slice(0, 6)}`, authorized_twin_id: randomUUID(), ...predmet }).replace(/'/g, "''");
  svc(`insert into public.production_workflow_steps (batch_id, step_name, step_order, step_code, status, input_data)
       values ('${batch}', 'nakladka', 1, 'nakladka', 'pending', '${input}'::jsonb)`);
  return svc(`insert into public.production_workflow_steps (batch_id, step_name, step_order, step_code, status, input_data)
              values ('${batch}', '${kod}', 3, '${kod}', 'pending', '${input}'::jsonb) returning id`);
}

beforeAll(() => {
  if (!dbAvailable) return;
  // Projekce BEZ odběratele (counterparty) — ten na tablet nesmí.
  svc(`insert into public.kiosk_rozsah (kod, step_code, input_match, pole)
       values ('f2c-${RUN}', 'predani', '{"carrier_name":"${NASE}"}'::jsonb,
               array['dl_number','driver_name','vehicle_registration','delivery_address'])`);
});

describe("F2-C — dnešní rozvozy pro tablet (DB naostro)", () => {
  it.skipIf(!dbAvailable)("nabídka řidičů i vozidel (tahač soupravy); rozvozy jen s projekcí z rozsahu", () => {
    const ucet = schvalenyTablet();
    const a = beh({ carrier_name: NASE, driver_name: RIDIC, vehicle_registration: "1T2 3456/2T3 4567", counterparty: "Jan Novák", delivery_address: "Stavba Opava" });
    beh({ carrier_name: NASE, driver_name: RIDIC, vehicle_registration: "1T23456+NV12345", counterparty: "Firma s.r.o.", delivery_address: "Lom" });
    beh({ carrier_name: `CIZI-${RUN}`, driver_name: `Cizí ${RUN}`, vehicle_registration: "9Z99999" });
    beh({ carrier_name: NASE, driver_name: `Včera ${RUN}` }, "current_date - 1");

    const nabidka = rozvozy(ucet, null, null);
    expect(nabidka.ok).toBe(true);
    const mojiRidici = nabidka.ridici.filter((r: { hodnota: string }) => r.hodnota.includes(RUN));
    expect(mojiRidici).toEqual([{ hodnota: RIDIC, k_predani: 2, hotovo: 0 }]);
    expect(nabidka.vozidla).toContainEqual({ hodnota: "1T23456", k_predani: 2, hotovo: 0 });
    expect(JSON.stringify(nabidka)).not.toContain("9Z99999");

    const podleRidice = rozvozy(ucet, "ridic", RIDIC);
    expect(podleRidice.rozvozy).toHaveLength(2);
    for (const r of podleRidice.rozvozy) {
      expect(r.step_code).toBe("predani");
      expect(Object.keys(r.pole).sort()).toEqual(["delivery_address", "dl_number", "driver_name", "vehicle_registration"]);
    }
    expect(JSON.stringify(podleRidice)).not.toMatch(/Jan Novák|Firma s\.r\.o\.|counterparty|carrier_name|authorized_twin_id/);

    const podleVozidla = rozvozy(ucet, "vozidlo", "1t2-3456");
    expect(podleVozidla.rozvozy.map((r: { id: string }) => r.id)).toContain(a);
  });

  it.skipIf(!dbAvailable)("řádek jen_flotila: v nabídce jen řidič s potvrzeným párováním s Webdispečinkem", () => {
    const kod = `wd-${RUN}`;
    svc(`insert into public.kiosk_rozsah (kod, step_code, input_match, pole, jen_flotila)
         values ('f2c-wd-${RUN}', '${kod}', '{}'::jsonb, array['dl_number','driver_name'], true)`);
    const ucet = schvalenyTablet();
    beh({ driver_name: `WD náš ${RUN}`, authorized_twin_id: ridicWd() }, "current_date", kod);
    beh({ driver_name: `WD cizí ${RUN}` }, "current_date", kod);
    const nabidka = JSON.stringify(rozvozy(ucet, null, null));
    expect(nabidka).toContain(`WD náš ${RUN}`);
    expect(nabidka).not.toContain(`WD cizí ${RUN}`);
    svc(`update public.kiosk_rozsah set aktivni = false where kod = 'f2c-wd-${RUN}'`);
  });

  it.skipIf(!dbAvailable)("okno NEDORUČENÝCH z rozsahu: D−3 … D+1 nevyřízené, mimo okno ne; výchozí 0/0 = jen dnes", () => {
    const okno = `OKNO-${RUN}`;
    svc(`insert into public.kiosk_rozsah (kod, step_code, input_match, pole, okno_zpet, okno_dopredu)
         values ('f2c-okno-${RUN}', 'predani', '{"carrier_name":"${okno}"}'::jsonb, array['dl_number','driver_name'], 3, 1)`);
    const ucet = schvalenyTablet();
    const ridic = (d: string) => `Okno ${d} ${RUN}`;
    for (const [d, den] of [["m3", "current_date - 3"], ["m4", "current_date - 4"], ["p1", "current_date + 1"], ["p2", "current_date + 2"]]) {
      beh({ carrier_name: okno, driver_name: ridic(d) }, den);
    }
    const nabidka = JSON.stringify(rozvozy(ucet, null, null));
    expect(nabidka).toContain(ridic("m3"));
    expect(nabidka).toContain(ridic("p1"));
    expect(nabidka).not.toContain(ridic("m4"));
    expect(nabidka).not.toContain(ridic("p2"));
    svc(`update public.kiosk_rozsah set aktivni = false where kod = 'f2c-okno-${RUN}'`);
  });

  it.skipIf(!dbAvailable)("doklad, který zdroj hlásí jako vyřízený, mezi nedoručenými není (ukazatel i identita; bez záznamu zůstává)", () => {
    const zdroj = `ZDROJ-${RUN}`;
    svc(`insert into public.kiosk_rozsah (kod, step_code, input_match, pole, zdroj_stav)
         values ('f2c-zdroj-${RUN}', 'predani', '{"carrier_name":"${zdroj}"}'::jsonb, array['dl_number','driver_name'],
                 '{"field":"settled","closed_when":"True","stable_key":"money_id"}'::jsonb)`);
    const registr = (slug: string, pole: Record<string, unknown>) =>
      svc(`insert into public.li_source_registry (source_sha256, doc_slug, doc_type, status, fields)
           values ('${randomUUID()}', '${slug}', 'dodaci_list', 'AUTO_PASS', '${JSON.stringify(pole)}'::jsonb)`);
    const ucet = schvalenyTablet();
    const r = (x: string) => `Zdroj ${x} ${RUN}`;
    registr(`dl-vyrizeny-${RUN}`, { settled: { value: "True" } });
    beh({ carrier_name: zdroj, driver_name: r("vyrizeny"), doc_slug: `dl-vyrizeny-${RUN}` });
    registr(`dl-otevreny-${RUN}`, { settled: { value: "False" } });
    beh({ carrier_name: zdroj, driver_name: r("otevreny"), doc_slug: `dl-otevreny-${RUN}` });
    // Ukazatel na doklad chybí → rozhodne identita (stable_key money_id).
    registr(`jiny-slug-${RUN}`, { settled: { value: "true" }, money_id: { value: `M-${RUN}` } });
    beh({ carrier_name: zdroj, driver_name: r("identita"), money_id: `M-${RUN}` });
    // Bez záznamu v registru = nevím → zůstává (fail-open, jako páska řidiče).
    beh({ carrier_name: zdroj, driver_name: r("bezzaznamu"), doc_slug: `nikde-${RUN}` });

    const nabidka = JSON.stringify(rozvozy(ucet, null, null));
    expect(nabidka).not.toContain(r("vyrizeny"));
    expect(nabidka).not.toContain(r("identita"));
    expect(nabidka).toContain(r("otevreny"));
    expect(nabidka).toContain(r("bezzaznamu"));
    svc(`update public.kiosk_rozsah set aktivni = false where kod = 'f2c-zdroj-${RUN}'`);
  });

  it.skipIf(!dbAvailable)("dnes předané zůstane v seznamu jako hotovo", () => {
    const ucet = schvalenyTablet();
    const ridic = `Hotovo ${RUN}`;
    const krok = beh({ carrier_name: NASE, driver_name: ridic });
    svc(`update public.production_workflow_steps set status = 'completed', completed_at = now() where id = '${krok}'`);
    expect(rozvozy(ucet, null, null).ridici).toContainEqual({ hodnota: ridic, k_predani: 0, hotovo: 1 });
    expect(rozvozy(ucet, "ridic", ridic).rozvozy[0]).toMatchObject({ id: krok, stav: "completed" });
  });

  it.skipIf(!dbAvailable)("⛔ člověk (i s rolí member) ani odvolaný tablet rozvozy nedostane", () => {
    const clovek = randomUUID();
    svc(`insert into aisha_auth.users (id, email) values ('${clovek}', 'clovek-${RUN}@test.local')`);
    expect(rozvozy(clovek, null, null)).toEqual({ ok: false, error: "jen_zarizeni" });

    const ucet = schvalenyTablet();
    const kid = sql(null, `select kid from public.knock_device_credentials where ucet_id = '${ucet}'`);
    svc(`select public.admin_set_knock_device_approval('${kid}', false)`);
    expect(rozvozy(ucet, null, null)).toEqual({ ok: false, error: "jen_zarizeni" });
  });

  it.skipIf(!dbAvailable)("⛔ výběr podle řidiče nejde, když rozsah jméno řidiče nepustí", () => {
    const tajne = `TAJNE-${RUN}`;
    svc(`insert into public.kiosk_rozsah (kod, step_code, input_match, pole)
         values ('f2c-tajne-${RUN}', 'predani', '{"carrier_name":"${tajne}"}'::jsonb, array['dl_number'])`);
    const ucet = schvalenyTablet();
    beh({ carrier_name: tajne, driver_name: `Skrytý ${RUN}`, vehicle_registration: "5T55555" });
    const nabidka = rozvozy(ucet, null, null);
    expect(JSON.stringify(nabidka)).not.toContain(`Skrytý ${RUN}`);
    expect(JSON.stringify(nabidka)).not.toContain("5T55555");
    expect(rozvozy(ucet, "ridic", `Skrytý ${RUN}`).rozvozy).toEqual([]);
    svc(`update public.kiosk_rozsah set aktivni = false where kod = 'f2c-tajne-${RUN}'`);
  });

  it.skipIf(!dbAvailable)("detail kroku: tablet dostane JEN projekci — bez odběratele, dřívějšího přebírajícího i názvu běhu", () => {
    const ucet = schvalenyTablet();
    const krok = beh({ carrier_name: NASE, driver_name: `Detail ${RUN}`, counterparty: "Jan Novák", delivery_address: "Stavba Opava" });
    svc(`update public.production_workflow_steps
            set output_data = '{"recipient":"Petr Přebírající","signature":"data:image/png;base64,AAA"}'::jsonb,
                notes = 'volat 777 123 456' where id = '${krok}'`);
    const detail = JSON.parse(jakoKlient(ucet, `select to_jsonb(d) from public.get_workflow_step_detail('${krok}') d`));
    expect(Object.keys(detail.input_data).sort()).toEqual(["delivery_address", "dl_number", "driver_name"]);
    expect(detail).toMatchObject({ output_data: null, notes: null, product_name: null, assigned_twin: null, is_mine: true });
    expect(JSON.stringify(detail)).not.toMatch(/Jan Novák|Petr|777 123 456|carrier_name|authorized_twin_id|counterparty/);
    // ↑ celé zasazené číslo z poznámky, ne „777“ — to trefí i náhodné hex UUID kroku/dávky (CI #1126 běh 4132).

    // Nakládka téhož běhu tablet NEvidí — detail je prázdný (neexistuje = nemá nárok).
    const nakladka = sql(null, `select id from public.production_workflow_steps
                                 where step_code = 'nakladka'
                                   and batch_id = (select batch_id from public.production_workflow_steps where id = '${krok}')`);
    expect(jakoKlient(ucet, `select count(*) from public.get_workflow_step_detail('${nakladka}')`)).toBe("0");
  });

  it.skipIf(!dbAvailable)("vadný režim / chybějící hodnota = chyba, ne tichý prázdný seznam", () => {
    const ucet = schvalenyTablet();
    expect(rozvozy(ucet, "zakaznik", "x")).toEqual({ ok: false, error: "rezim" });
    expect(rozvozy(ucet, "ridic", null)).toEqual({ ok: false, error: "hodnota" });
  });
});
