/**
 * F1 tabletů nad SKUTEČNOU databází: ohlášení → schválení správcem → roster dveří →
 * ověření rámce VER 2 klíčem, který roster vydal. A odvolání cestou zpátky.
 *
 * ⛔ PROČ (RIQi 2026-09-29, kolo 11): SQL funkce F1 (enrol_kiosk_device,
 * kiosk_device_stav, knock_roster_zarizeni, admin_list_knock_devices) neměly žádný
 * DB test a řetěz enrol → approve → roster → verifyFrame nespouštělo nic. Brána
 * testovala routy s injektovanými dveřmi, svc-knock roster s ručně psanými daty —
 * každý kus zelený, spoj mezi nimi nikdo. Tady jde roster z DB přesně tou cestou,
 * kterou jde ve svc-knock: posudRoster (křížová kontrola počtu) → spojSeZakladem →
 * verifyFrame.
 *
 * Klíč tabletu vzniká tady (náhrada Android Keystore) a soukromá půlka test neopustí.
 */
import crypto, { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";
import { decodeFrame, encodeFrameDevice, kidZKlice, verifyFrame, type Operator } from "@aisha/knock-protocol";
import { nodeCrypto } from "@aisha/knock-protocol/node";
import { posudRoster, spojSeZakladem } from "../../../services/svc-knock/src/roster.js";

const dbAvailable = isPgReachable();
const RUN = randomUUID().slice(0, 8);
// Vlastní adresa ohlášení pro tenhle běh — strop 20/adresu/h se jinak sčítá napříč běhy.
const IP = `10.${crypto.randomInt(1, 250)}.${crypto.randomInt(1, 250)}.${crypto.randomInt(1, 250)}`;

function sql(claims: string | null, q: string): string {
  const pre = claims === null ? "" : `\\o /dev/null\nSET request.jwt.claims = '${claims}';\n\\o\n`;
  return execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tAq"],
    { encoding: "utf8", input: `${pre}${q};`, env: { ...process.env, PGPASSWORD: PG_PASSWORD } },
  ).trim();
}
const svc = (q: string) => sql('{"role":"service_role"}', q);
const clen = (q: string) => sql(`{"role":"authenticated","sub":"${randomUUID()}"}`, q);

function tablet(): { pubHex: string; kid: string; podepis: (m: Uint8Array) => Uint8Array } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const pubHex = Buffer.concat([Buffer.from([0x04]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]).toString("hex");
  return {
    pubHex,
    kid: kidZKlice(pubHex),
    podepis: (m) => new Uint8Array(crypto.createSign("SHA256").update(m).sign({ key: privateKey, dsaEncoding: "ieee-p1363" })),
  };
}
const enrol = (t: { kid: string; pubHex: string }, scope = `kiosk-${RUN}`, ip = IP, verze = `{"kioskAdmin":"1.5.0 (7)"}`) =>
  JSON.parse(svc(`select public.enrol_kiosk_device('${t.kid}', '${t.pubHex}', '${scope}', '${ip}'::inet, '${verze}'::jsonb)`)) as
    { ok: boolean; stav?: string; error?: string };
const stav = (kid: string) => (JSON.parse(svc(`select public.kiosk_device_stav('${kid}')`)) as { stav?: string }).stav;
const roster = () =>
  JSON.parse(svc("select public.knock_roster_zarizeni()")) as { operators: Record<string, Operator>; version: string; count: number };
const ted = () => Math.floor(Date.now() / 1000);
const overeni = (operators: Record<string, Operator>) => ({
  operators, crypto: nodeCrypto, now: ted(), windowSec: 30, otpStep: 30, otpDigits: 6,
});

describe("F1 tabletů — ohlášení, schválení, roster, dveře (DB naostro)", () => {
  it.skipIf(!dbAvailable)("⛔ přihlášený člověk nesmí ohlásit tablet ani číst roster dveří", () => {
    const t = tablet();
    expect(() => clen(`select public.enrol_kiosk_device('${t.kid}', '${t.pubHex}', 's', '${IP}'::inet, null)`)).toThrow(/Unauthorized/);
    expect(() => clen("select public.knock_roster_zarizeni()")).toThrow(/Unauthorized/);
    expect(() => clen("select public.kiosk_device_stav('dev-x')")).toThrow(/Unauthorized/);
  });

  it.skipIf(!dbAvailable)("vadné ohlášení se odmítne s důvodem, nic nezapíše", () => {
    const t = tablet();
    expect(enrol({ kid: t.kid, pubHex: "04abc" })).toMatchObject({ ok: false, error: expect.stringMatching(/SEC1/) });
    expect(enrol({ kid: "dev-vymysleny0000", pubHex: t.pubHex })).toMatchObject({ ok: false, error: expect.stringMatching(/kid/) });
    expect(enrol(t, "")).toMatchObject({ ok: false, error: expect.stringMatching(/scope/) });
    expect(sql(null, `select count(*) from public.knock_device_credentials where kid = '${t.kid}'`)).toBe("0");
  });

  it.skipIf(!dbAvailable)("ohlášení → čeká; roster ho NEvydá; správce ho vidí s adresou a verzemi", () => {
    const t = tablet();
    expect(enrol(t)).toEqual({ ok: true, kid: t.kid, stav: "ceka" });
    expect(stav(t.kid)).toBe("ceka");
    expect(roster().operators).not.toHaveProperty(t.kid);
    const radek = svc(`select druh || '|' || split_part(ohlaseno_z_ip, '/', 1) || '|' || (verze->>'kioskAdmin')
                         from public.admin_list_knock_devices(null, 'tablet') where kid = '${t.kid}'`);
    expect(radek).toBe(`tablet|${IP}|1.5.0 (7)`);
    // Opakované ohlášení téhož klíče = týž průkaz (žádný duplikát), jen čerstvé verze.
    expect(enrol(t, `kiosk-${RUN}`, IP, `{"kioskAdmin":"1.5.1 (8)"}`)).toMatchObject({ ok: true, stav: "ceka" });
    expect(sql(null, `select count(*) || '|' || (max(verze->>'kioskAdmin')) from public.knock_device_credentials where kid = '${t.kid}'`))
      .toBe("1|1.5.1 (8)");
  });

  it.skipIf(!dbAvailable)("schválení → roster ho vydá a rámec podepsaný tabletem projde dveřmi (cesta svc-knock)", () => {
    const t = tablet();
    enrol(t);
    svc(`select public.admin_set_knock_device_approval('${t.kid}', true)`);
    expect(stav(t.kid)).toBe("schvaleno");

    const r = roster();
    expect(r.operators[t.kid]).toMatchObject({ publicKeyHex: t.pubHex, scopes: [`kiosk-${RUN}`], kind: "device" });
    const posudek = posudRoster(r.operators, r.count);
    expect(posudek.ok, JSON.stringify(posudek)).toBe(true);
    const spojeni = spojSeZakladem({}, posudek.ok ? posudek.operators : {}, {});
    expect(spojeni.ok).toBe(true);
    const ops = spojeni.ok ? spojeni.operators : {};

    const { frame } = encodeFrameDevice(nodeCrypto, { kid: t.kid, ts: ted(), scope: `kiosk-${RUN}` }, t.podepis);
    expect(verifyFrame(decodeFrame(frame), overeni(ops))).toEqual({ ok: true, reason: "ok" });

    // Cizí klíč pod týmž kid dveřmi neprojde.
    const cizi = tablet();
    const { frame: podvrh } = encodeFrameDevice(nodeCrypto, { kid: t.kid, ts: ted(), scope: `kiosk-${RUN}` }, cizi.podepis);
    expect(verifyFrame(decodeFrame(podvrh), overeni(ops)).ok).toBe(false);
  });

  it.skipIf(!dbAvailable)("odvolání → roster ho nevydá, dveře ho zavřou a nové ohlášení ho NEobnoví", () => {
    const t = tablet();
    enrol(t);
    svc(`select public.admin_set_knock_device_approval('${t.kid}', true)`);
    const pred = roster().operators;
    svc(`select public.admin_set_knock_device_approval('${t.kid}', false)`);
    expect(stav(t.kid)).toBe("odvolano");

    const po = roster();
    expect(po.operators).not.toHaveProperty(t.kid);
    const spojeni = spojSeZakladem({}, po.operators, pred);
    expect(spojeni.ok && spojeni.odebrane).toContain(t.kid);

    const { frame } = encodeFrameDevice(nodeCrypto, { kid: t.kid, ts: ted(), scope: `kiosk-${RUN}` }, t.podepis);
    expect(verifyFrame(decodeFrame(frame), overeni(spojeni.ok ? spojeni.operators : {})).ok).toBe(false);
    expect(enrol(t)).toMatchObject({ ok: true, stav: "odvolano" });
  });

  it.skipIf(!dbAvailable)("strop: z jedné adresy nejvýš 20 NOVÝCH tabletů za hodinu", () => {
    const ip = `10.${crypto.randomInt(1, 250)}.${crypto.randomInt(1, 250)}.${crypto.randomInt(1, 250)}`;
    for (let i = 0; i < 20; i++) expect(enrol(tablet(), `kiosk-${RUN}`, ip).ok).toBe(true);
    expect(enrol(tablet(), `kiosk-${RUN}`, ip)).toMatchObject({ ok: false, error: expect.stringMatching(/příliš mnoho/) });
  });
});
