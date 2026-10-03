/**
 * F2-A nad SKUTEČNOU databází: vlastní účet tabletu a pátá cesta viditelnosti.
 *
 * Majitel 2026-09-29: tablet nabídne dnešní rozvozy naší dopravy bez osobních údajů.
 * „Naše doprava“ = přepravce z dodacího listu (`carrier_name` v předmětu běhu), a to
 * v několika zápisech téhož dopravce — každý zápis je ŘÁDEK `kiosk_rozsah` (data instance,
 * návrh z ingestu schvaluje člověk), v kódu se žádný dopravce nejmenuje.
 * Revize Aisha Guru: účet zařízení zakládá JEN definer při schválení, příznak nese server
 * (ne raw_user_meta_data), pátá cesta kontroluje platný průkaz při KAŽDÉM volání,
 * rozsah je data instance (`kiosk_rozsah`).
 *
 * Pinuje CHOVÁNÍ: kdo účet dostane a s jakou rolí, co tablet uvidí a co ne, že odbavení
 * zapíše tablet a nevyplatí mu odměnu, a že odvolání/vypršení platí hned.
 *
 * Od 2026-09-30 (majitel: „z našich řidičů — co máme spárované s Webdispečinkem; tablet si
 * to sám řešit nemá“): řádek s `jen_flotila` pustí JEN krok naší flotily — potvrzené, platné
 * párování řidiče (dvojče driver) nebo vozidla (SPZ z Webdispečinku → dvojče vehicle).
 * Řádky dopravců bez příznaku platí dál (přechod řídí data, revize RIQi).
 */
import crypto, { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

const dbAvailable = isPgReachable();
const RUN = randomUUID().slice(0, 8);
const NASE = `NASE-${RUN}`;
/** Týž dopravce jinak zapsaný (v datech 4 zápisy jednoho dopravce) — druhý řádek rozsahu. */
const NASE_JINAK = `Nase ${RUN} a.s.`;

function sql(claims: string | null, q: string): string {
  const pre = claims === null ? "" : `\\o /dev/null\nSET request.jwt.claims = '${claims}';\n\\o\n`;
  return execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tAq"],
    { encoding: "utf8", input: `${pre}${q};`, env: { ...process.env, PGPASSWORD: PG_PASSWORD } },
  ).trim();
}
const svc = (q: string) => sql('{"role":"service_role"}', q);
/** Jako skutečný klient: claim + ROLE authenticated (granty a RLS platí). */
const jakoKlient = (uid: string, q: string) =>
  sql(null, `SET request.jwt.claims = '${JSON.stringify({ role: "authenticated", sub: uid, aisha_user_id: uid })}';\nSET ROLE authenticated;\n${q}`);
/** Logika podle claimů (superuživatel, takže řádky kroků jdou vybrat bez RLS). */
const jako = (uid: string, q: string, kid?: string) =>
  sql(JSON.stringify({ role: "authenticated", sub: uid, aisha_user_id: uid, ...(kid ? { device_kid: kid } : {}) }), q);

function tablet(): { pubHex: string; kid: string } {
  const { publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const pubHex = Buffer.concat([Buffer.from([0x04]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]).toString("hex");
  return { pubHex, kid: `dev-${pubHex.slice(2, 18)}` };
}
const IP = () => `10.${crypto.randomInt(1, 250)}.${crypto.randomInt(1, 250)}.${crypto.randomInt(1, 250)}`;
function schvalenyTablet(): { kid: string; ucet: string } {
  const t = tablet();
  svc(`select public.enrol_kiosk_device('${t.kid}', '${t.pubHex}', 'kiosk-${RUN}', '${IP()}'::inet, null)`);
  svc(`select public.admin_set_knock_device_approval('${t.kid}', true)`);
  return { kid: t.kid, ucet: sql(null, `select ucet_id from public.knock_device_credentials where kid = '${t.kid}'`) };
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
/** Vozidla WD, která tahle sada založila — `afterAll` je smaže. Sada `wd-projekce-dvojcata`
 *  počítá CELOU `wd_vehicles` (objektu: 1) a v rohatce běží ve stejné DB po nás. */
const zalozenaVozidla: number[] = [];
function vozidloWd(spz: string, druh = "vehicle", aktivni = true): void {
  const car = crypto.randomInt(1_000_000, 2_000_000_000);
  zalozenaVozidla.push(car);
  svc(`insert into public.wd_vehicles (wd_car_id, identifier, active) values (${car}, '${spz}', ${aktivni})`);
  const twin = svc(`insert into public.twin_entities (entity_type, label) values ('${druh}', '${spz}') returning id`);
  svc(`insert into public.twin_external_refs (twin_id, source, source_key, ref_kind, state, proposed_by, confirmed_at)
       values ('${twin}', 'webdispecink', '${car}', 'primary_id', 'confirmed', 'test:${RUN}', now())`);
}
/** Krok s kódem, který pokrývá JEN řádek `jen_flotila` (izolovaný od ostatních testů). */
const KOD_WD = `wd-${RUN}`;
function krokWd(ridic: string, spz: string | null = null): string {
  const batch = svc(`insert into public.production_batches (batch_code, product_name, production_date)
                     values ('expedice:${randomUUID().slice(0, 8)}-${RUN}', 'Test', current_date) returning id`);
  const input = JSON.stringify({ dl_number: `DL-${RUN}`, authorized_twin_id: ridic, ...(spz ? { vehicle_registration: spz } : {}) });
  return svc(`insert into public.production_workflow_steps (batch_id, step_name, step_order, step_code, status, input_data)
              values ('${batch}', '${KOD_WD}', 3, '${KOD_WD}', 'pending', '${input}'::jsonb) returning id`);
}
/** Běh se třemi kroky: nakládka a předání NAŠÍ dopravy, a předání CIZÍ dopravy. */
function beh(dopravce: string): { nakladka: string; predani: string } {
  const batch = svc(`insert into public.production_batches (batch_code, product_name, production_date)
                     values ('expedice:${randomUUID().slice(0, 8)}-${RUN}', 'Test', current_date) returning id`);
  const input = `{"carrier_name":"${dopravce}","dl_number":"DL-${RUN}","authorized_twin_id":"${randomUUID()}"}`;
  const krok = (code: string, order: number) =>
    svc(`insert into public.production_workflow_steps (batch_id, step_name, step_order, step_code, status, input_data)
         values ('${batch}', '${code}', ${order}, '${code}', 'pending', '${input}'::jsonb) returning id`);
  return { nakladka: krok("nakladka", 1), predani: krok("predani", 3) };
}
const vidi = (uid: string, krok: string, kod: string | null, kid?: string) =>
  jako(uid, `select public.workflow_step_visible_to('${uid}', s.assigned_user_id, s.assigned_role, s.input_data, null,
               ${kod === null ? "null" : `'${kod}'`}) from public.production_workflow_steps s where s.id = '${krok}'`, kid) === "t";

beforeAll(() => {
  if (!dbAvailable) return;
  svc(`insert into public.kiosk_rozsah (kod, step_code, input_match, pole)
       values ('test-${RUN}', 'predani', '{"carrier_name":"${NASE}"}'::jsonb, array['dl_number']),
              ('test-${RUN}-b', 'predani', '{"carrier_name":"${NASE_JINAK}"}'::jsonb, array['dl_number'])`);
  // Řádek flotily: prázdné zúžení jako v produkci (v2), ale na izolovaném kódu kroku.
  svc(`insert into public.kiosk_rozsah (kod, step_code, input_match, pole, jen_flotila)
       values ('test-${RUN}-wd', '${KOD_WD}', '{}'::jsonb, array['dl_number'], true)`);
});

afterAll(() => {
  if (!dbAvailable || zalozenaVozidla.length === 0) return;
  svc(`delete from public.wd_vehicles where wd_car_id = any(array[${zalozenaVozidla.join(",")}]::int[])`);
});

describe("F2-A — účet tabletu a pátá cesta (DB naostro)", () => {
  it.skipIf(!dbAvailable)("schválení tabletu založí účet BEZ role member; profil ano", () => {
    const { kid, ucet } = schvalenyTablet();
    expect(ucet).toMatch(/^[0-9a-f-]{36}$/);
    expect(sql(null, `select count(*) from public.user_roles where user_id = '${ucet}'`)).toBe("0");
    expect(sql(null, `select count(*) from public.profiles where user_id = '${ucet}'`)).toBe("1");
    // Opakované schválení = týž účet (idempotentní).
    svc(`select public.admin_set_knock_device_approval('${kid}', true)`);
    expect(sql(null, `select ucet_id from public.knock_device_credentials where kid = '${kid}'`)).toBe(ucet);
  });

  it.skipIf(!dbAvailable)("⛔ běžná registrace s druh='zarizeni' v metadatech: member ZŮSTANE, cesta zařízení NE", () => {
    const u = randomUUID();
    svc(`insert into aisha_auth.users (id, email, raw_user_meta_data)
         values ('${u}', 'podvrh-${RUN}@test.local', '{"druh":"zarizeni","kind":"device"}'::jsonb)`);
    expect(sql(null, `select string_agg(role::text, ',') from public.user_roles where user_id = '${u}'`)).toBe("member");
    expect(jako(u, `select public.je_ucet_zarizeni_platny('${u}')`)).toBe("f");
    const b = beh(NASE);
    expect(vidi(u, b.predani, "predani")).toBe(false);
  });

  it.skipIf(!dbAvailable)("tablet vidí JEN předání naší dopravy — ne nakládku, ne cizí, ne bez kódu kroku", () => {
    const { kid, ucet } = schvalenyTablet();
    const nas = beh(NASE);
    const cizi = beh(`CIZI-${RUN}`);
    expect(vidi(ucet, nas.predani, "predani", kid)).toBe(true);
    expect(vidi(ucet, nas.nakladka, "nakladka", kid)).toBe(false);
    expect(vidi(ucet, cizi.predani, "predani", kid)).toBe(false);
    expect(vidi(ucet, nas.predani, null, kid), "bez kódu kroku z řádku cesta neplatí").toBe(false);
  });

  it.skipIf(!dbAvailable)("víc zápisů téhož dopravce = víc řádků rozsahu; zápis, který nikdo neschválil, NEvidí", () => {
    const { kid, ucet } = schvalenyTablet();
    expect(vidi(ucet, beh(NASE_JINAK).predani, "predani", kid)).toBe(true);
    // Nový zápis (překlep, jiná velikost písmen) = fail-closed, dokud ho člověk nepřidá.
    expect(vidi(ucet, beh(NASE.toLowerCase()).predani, "predani", kid)).toBe(false);
    // Vypnutý řádek platí hned.
    svc(`update public.kiosk_rozsah set aktivni = false where kod = 'test-${RUN}-b'`);
    expect(vidi(ucet, beh(NASE_JINAK).predani, "predani", kid)).toBe(false);
    svc(`update public.kiosk_rozsah set aktivni = true where kod = 'test-${RUN}-b'`);
  });

  it.skipIf(!dbAvailable)("řádek jen_flotila: řidič s POTVRZENÝM a platným párováním ano; návrh, prošlé, jiný druh ne", () => {
    const { kid, ucet } = schvalenyTablet();
    expect(vidi(ucet, krokWd(ridicWd()), KOD_WD, kid), "náš řidič").toBe(true);
    // Shoda jména z dodáku je jen návrh — dvojče bez párování, návrh, prošlá vazba, jiný druh.
    expect(vidi(ucet, krokWd(randomUUID()), KOD_WD, kid), "bez párování").toBe(false);
    expect(vidi(ucet, krokWd(ridicWd("proposed")), KOD_WD, kid), "jen návrh").toBe(false);
    expect(vidi(ucet, krokWd(ridicWd("confirmed", "now() - interval '1 hour'")), KOD_WD, kid), "prošlé").toBe(false);
    expect(vidi(ucet, krokWd(ridicWd("confirmed", null, "person")), KOD_WD, kid), "druh person").toBe(false);
  });

  it.skipIf(!dbAvailable)("řádek jen_flotila: vozidlo spárované s Webdispečinkem stačí i s cizím řidičem (tahač, souprava)", () => {
    const { kid, ucet } = schvalenyTablet();
    const n = crypto.randomInt(1000, 9999);
    vozidloWd(`1T${n % 10} ${n}`);
    expect(vidi(ucet, krokWd(randomUUID(), `1t${n % 10}${n} / 2T3 4567`), KOD_WD, kid)).toBe(true);
    // ⛔ Druh je součást klíče: vůz spárovaný na dvojče řidiče se nepočítá.
    const m = crypto.randomInt(1000, 9999);
    vozidloWd(`5S${m % 10} ${m}`, "driver");
    expect(vidi(ucet, krokWd(randomUUID(), `5S${m % 10} ${m}`), KOD_WD, kid), "druh driver").toBe(false);
    // Vyřazené vozidlo Webdispečinku (active = false) už flotila není.
    const o = crypto.randomInt(1000, 9999);
    vozidloWd(`7A${o % 10} ${o}`, "vehicle", false);
    expect(vidi(ucet, krokWd(randomUUID(), `7A${o % 10} ${o}`), KOD_WD, kid), "neaktivní").toBe(false);
  });

  it.skipIf(!dbAvailable)("řádek dopravce bez jen_flotila platí dál i bez párování (přechod řídí data)", () => {
    const { kid, ucet } = schvalenyTablet();
    expect(vidi(ucet, beh(NASE).predani, "predani", kid)).toBe(true);
  });

  it.skipIf(!dbAvailable)("⛔ pomocník flotily není pro klienta (věštírna „je tahle SPZ naše?“)", () => {
    expect(() => jakoKlient(randomUUID(), `select public.kiosk_krok_nasi_flotily('{}'::jsonb)`)).toThrow(/permission denied/);
  });

  it.skipIf(!dbAvailable)("tablet odbaví předání: zapíše se účet tabletu, odměna se NEvyplatí; nakládku odbavit nesmí", () => {
    const { kid, ucet } = schvalenyTablet();
    const b = beh(NASE);
    const r = JSON.parse(jako(ucet, `select public.complete_workflow_step('${b.predani}', '{"recipient":"x"}'::jsonb)`, kid));
    expect(r).toMatchObject({ ok: true, completed_by: ucet, reward: { skipped: "device", kid } });
    const n = JSON.parse(jako(ucet, `select public.complete_workflow_step('${b.nakladka}', '{}'::jsonb)`, kid));
    expect(n.ok).toBe(false);
  });

  it.skipIf(!dbAvailable)("podvržený device_kid (cizí kid) se neuzná; vlastní ano", () => {
    const a = schvalenyTablet();
    const b = schvalenyTablet();
    expect(jako(a.ucet, "select coalesce(public.current_device_kid(), '-')", a.kid)).toBe(a.kid);
    expect(jako(a.ucet, "select coalesce(public.current_device_kid(), '-')", b.kid)).toBe("-");
  });

  it.skipIf(!dbAvailable)("odvolání i vypršení průkazu platí HNED (kontrola při každém volání)", () => {
    const x = schvalenyTablet();
    const b1 = beh(NASE);
    expect(vidi(x.ucet, b1.predani, "predani", x.kid)).toBe(true);
    svc(`select public.admin_set_knock_device_approval('${x.kid}', false)`);
    expect(vidi(x.ucet, b1.predani, "predani", x.kid)).toBe(false);
    expect(JSON.parse(jako(x.ucet, `select public.complete_workflow_step('${b1.predani}', '{}'::jsonb)`, x.kid)).ok).toBe(false);
    // Účet po odvolání zůstává (audit), jen ztratí platnost.
    expect(sql(null, `select count(*) from aisha_auth.users where id = '${x.ucet}'`)).toBe("1");

    const y = schvalenyTablet();
    const b2 = beh(NASE);
    svc(`update public.knock_device_credentials set plati_do = now() - interval '1 minute' where kid = '${y.kid}'`);
    expect(vidi(y.ucet, b2.predani, "predani", y.kid)).toBe(false);
  });

  it.skipIf(!dbAvailable)("⛔ klient nesmí založit účet zařízení sám", () => {
    const t = tablet();
    svc(`select public.enrol_kiosk_device('${t.kid}', '${t.pubHex}', 'kiosk-${RUN}', '${IP()}'::inet, null)`);
    expect(() => jakoKlient(randomUUID(), `select public.zaloz_ucet_zarizeni_interni('${t.kid}')`)).toThrow(/permission denied/);
    expect(sql(null, `select coalesce(ucet_id::text, '-') from public.knock_device_credentials where kid = '${t.kid}'`)).toBe("-");
  });
});
