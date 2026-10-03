/**
 * Položky dokladu kroku (get_workflow_step_polozky) nad SKUTEČNOU databází.
 *
 * Majitel 2026-09-30: „v mobilní aplikaci řidiče nevidím detail dodávky/dokladu — co,
 * kolik a čeho odvézt“. Položky jdou S KROKEM: nárok rozhoduje predikát kroku, tablet
 * dostane jen deklarované klíče (`kiosk_rozsah.pole_polozek`), člověk s nárokem na krok
 * celý řádek. Registr ani doc_slug volající nedostane.
 *
 * Pinuje CHOVÁNÍ: projekce pro tablet (a fail-closed bez ní), cizí krok = „nenalezeno“
 * (žádná věštírna), krok bez dokladu = poctivě prázdno, platná verze dokladu po řetězu.
 */
import crypto, { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

const dbAvailable = isPgReachable();
const RUN = randomUUID().slice(0, 8);
const NASE = `POL-${RUN}`;
const BEZ_POLOZEK = `POL0-${RUN}`;

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
const jakoKlient = (uid: string, q: string) =>
  sql(null, `SET request.jwt.claims = '${JSON.stringify({ role: "authenticated", sub: uid, aisha_user_id: uid })}';\nSET ROLE authenticated;\n${q}`);
const polozky = (uid: string, krok: string) =>
  JSON.parse(jakoKlient(uid, `select public.get_workflow_step_polozky('${krok}')`));

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
/** Řádek dokladu v registru; položky ve tvaru ingestu (pole s provenancí {value, …}). */
function doklad(slug: string, radky: Record<string, string>[], nahrazen: string | null = null): void {
  const polozky = JSON.stringify(
    radky.map((r, i) => ({ line_index: i, status: "AUTO_PASS", fields: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { value: v, raw: v }])) })),
  ).replace(/'/g, "''");
  svc(`insert into public.li_source_registry (source_sha256, doc_slug, doc_type, status, fields, line_items, superseded_by)
       values ('${randomUUID()}', '${slug}', 'dodaci_list', 'AUTO_PASS', '{}'::jsonb, '${polozky}'::jsonb,
               ${nahrazen ? `'${nahrazen}'` : "null"})`);
}
/** Krok předání ukazující na doklad (doc_slug), s dopravcem pro rozsah. */
function krok(dopravce: string, slug: string | null, prirazen: string | null = null): string {
  const batch = svc(`insert into public.production_batches (batch_code, product_name, production_date)
                     values ('expedice:${randomUUID().slice(0, 8)}-${RUN}', 'Test', current_date) returning id`);
  const input = JSON.stringify({ carrier_name: dopravce, dl_number: `DL-${RUN}`, ...(slug ? { doc_slug: slug } : {}) });
  return svc(`insert into public.production_workflow_steps (batch_id, step_name, step_order, step_code, status, input_data, assigned_user_id)
              values ('${batch}', 'predani', 3, 'predani', 'pending', '${input}'::jsonb, ${prirazen ? `'${prirazen}'` : "null"}) returning id`);
}
const RADKY = [
  { item_code: "K-1", item_name: "Kamenivo 8/16", quantity: "24.5", unit: "t", unit_price: "310" },
  { item_code: "K-2", item_name: "Písek 0/4", quantity: "12", unit: "t", unit_price: "280" },
];

beforeAll(() => {
  if (!dbAvailable) return;
  svc(`insert into public.kiosk_rozsah (kod, step_code, input_match, pole, pole_polozek)
       values ('pol-${RUN}', 'predani', '{"carrier_name":"${NASE}"}'::jsonb, array['dl_number'],
               array['item_name','quantity','unit']),
              ('pol0-${RUN}', 'predani', '{"carrier_name":"${BEZ_POLOZEK}"}'::jsonb, array['dl_number'], '{}')`);
});

describe("get_workflow_step_polozky — co, kolik a čeho odvézt (DB naostro)", () => {
  it.skipIf(!dbAvailable)("tablet dostane položky svého kroku JEN s deklarovanými klíči", () => {
    const ucet = schvalenyTablet();
    doklad(`dl-${RUN}-a`, RADKY);
    const r = polozky(ucet, krok(NASE, `dl-${RUN}-a`));
    expect(r).toEqual({
      ok: true,
      doklad: true,
      polozky: [
        { item_name: "Kamenivo 8/16", quantity: "24.5", unit: "t", stav_radku: "AUTO_PASS" },
        { item_name: "Písek 0/4", quantity: "12", unit: "t", stav_radku: "AUTO_PASS" },
      ],
    });
    expect(JSON.stringify(r)).not.toMatch(/unit_price|310|doc_slug|dl-/);
  });

  it.skipIf(!dbAvailable)("⛔ rozsah bez pole_polozek = tablet položky nedostane (fail-closed), krok ale vidí", () => {
    const ucet = schvalenyTablet();
    doklad(`dl-${RUN}-b`, RADKY);
    expect(polozky(ucet, krok(BEZ_POLOZEK, `dl-${RUN}-b`))).toEqual({ ok: true, doklad: true, polozky: [] });
  });

  it.skipIf(!dbAvailable)("⛔ cizí krok i neexistující krok = týž „nenalezeno“ (žádná věštírna)", () => {
    const ucet = schvalenyTablet();
    doklad(`dl-${RUN}-c`, RADKY);
    expect(polozky(ucet, krok(`CIZI-${RUN}`, `dl-${RUN}-c`))).toEqual({ ok: false, error: "nenalezeno" });
    expect(polozky(ucet, randomUUID())).toEqual({ ok: false, error: "nenalezeno" });
  });

  it.skipIf(!dbAvailable)("člověk s nárokem na krok dostane celý řádek (hodnoty bez provenance)", () => {
    const clovek = randomUUID();
    svc(`insert into aisha_auth.users (id, email) values ('${clovek}', 'ridic-${RUN}@test.local')`);
    doklad(`dl-${RUN}-d`, RADKY);
    const r = polozky(clovek, krok(`CIZI-${RUN}`, `dl-${RUN}-d`, clovek));
    expect(r.ok).toBe(true);
    expect(r.polozky[0]).toEqual({
      item_code: "K-1", item_name: "Kamenivo 8/16", quantity: "24.5", unit: "t", unit_price: "310", stav_radku: "AUTO_PASS",
    });
  });

  it.skipIf(!dbAvailable)("krok bez dokladu v registru = poctivě prázdno, ne chyba", () => {
    const ucet = schvalenyTablet();
    expect(polozky(ucet, krok(NASE, `nikde-${RUN}`))).toEqual({ ok: true, doklad: false, polozky: [] });
    expect(polozky(ucet, krok(NASE, null))).toEqual({ ok: true, doklad: false, polozky: [] });
  });

  it.skipIf(!dbAvailable)("položky z PLATNÉ verze dokladu po řetězu superseded_by", () => {
    const ucet = schvalenyTablet();
    doklad(`dl-${RUN}-v3`, [{ item_name: "Nová verze", quantity: "3", unit: "t" }]);
    doklad(`dl-${RUN}-v2`, [{ item_name: "Druhá verze", quantity: "2", unit: "t" }], `dl-${RUN}-v3`);
    doklad(`dl-${RUN}-v1`, [{ item_name: "Stará verze", quantity: "1", unit: "t" }], `dl-${RUN}-v2`);
    expect(polozky(ucet, krok(NASE, `dl-${RUN}-v1`)).polozky).toEqual([
      { item_name: "Nová verze", quantity: "3", unit: "t", stav_radku: "AUTO_PASS" },
    ]);
  });
});
