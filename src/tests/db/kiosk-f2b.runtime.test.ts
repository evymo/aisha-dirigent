/**
 * F2-B nad SKUTEČNOU databází: vydání relace tabletu (`kiosk_vydej_relaci`).
 *
 * Gateway (routes/zarizeni-klic.ts) ji volá AŽ po ověření podpisu klíčem z průkazu.
 * Tady se pinuje strana DB: kdo relaci dostane (jen schválený, neodvolaný, nevypršelý
 * tablet s účtem), že vydání zanechá stopu v auditu a že ji klient zavolat nesmí.
 */
import crypto, { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

const dbAvailable = isPgReachable();
const RUN = randomUUID().slice(0, 8);

function sql(claims: string | null, q: string): string {
  const pre = claims === null ? "" : `\\o /dev/null\nSET request.jwt.claims = '${claims}';\n\\o\n`;
  return execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tAq"],
    { encoding: "utf8", input: `${pre}${q};`, env: { ...process.env, PGPASSWORD: PG_PASSWORD } },
  ).trim();
}
const svc = (q: string) => sql('{"role":"service_role"}', q);
const jakoKlient = (uid: string, q: string) =>
  sql(null, `SET request.jwt.claims = '${JSON.stringify({ role: "authenticated", sub: uid, aisha_user_id: uid })}';\nSET ROLE authenticated;\n${q}`);

function ohlasenyTablet(): string {
  const { publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const pubHex = Buffer.concat([Buffer.from([0x04]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]).toString("hex");
  const kid = `dev-${pubHex.slice(2, 18)}`;
  const ip = `10.${crypto.randomInt(1, 250)}.${crypto.randomInt(1, 250)}.${crypto.randomInt(1, 250)}`;
  svc(`select public.enrol_kiosk_device('${kid}', '${pubHex}', 'kiosk-${RUN}', '${ip}'::inet, null)`);
  return kid;
}
const vydej = (kid: string) => JSON.parse(svc(`select public.kiosk_vydej_relaci('${kid}')`)) as
  { ok: boolean; duvod?: string; ucet_id?: string; kid?: string };

describe("F2-B — vydání relace tabletu (DB naostro)", () => {
  it.skipIf(!dbAvailable)("schválený tablet → účet průkazu; vydání se zapíše do auditu", () => {
    const kid = ohlasenyTablet();
    svc(`select public.admin_set_knock_device_approval('${kid}', true)`);
    const ucet = sql(null, `select ucet_id from public.knock_device_credentials where kid = '${kid}'`);
    expect(vydej(kid)).toEqual({ ok: true, ucet_id: ucet, kid, plati_do: null });
    expect(sql(null, `select count(*) from public.audit_journal
                      where action = 'knock_device_session_issued' and metadata->>'kid' = '${kid}'`)).toBe("1");
  });

  it.skipIf(!dbAvailable)("⛔ čekající, odvolaný, vypršelý i neznámý průkaz relaci nedostane (a audit se nepíše)", () => {
    const ceka = ohlasenyTablet();
    expect(vydej(ceka)).toEqual({ ok: false, duvod: "ceka" });

    const odvolany = ohlasenyTablet();
    svc(`select public.admin_set_knock_device_approval('${odvolany}', true)`);
    svc(`select public.admin_set_knock_device_approval('${odvolany}', false)`);
    expect(vydej(odvolany)).toEqual({ ok: false, duvod: "odvolano" });

    const vyprsely = ohlasenyTablet();
    svc(`select public.admin_set_knock_device_approval('${vyprsely}', true)`);
    svc(`update public.knock_device_credentials set plati_do = now() - interval '1 minute' where kid = '${vyprsely}'`);
    expect(vydej(vyprsely)).toEqual({ ok: false, duvod: "neplatne" });

    expect(vydej(`dev-${"0".repeat(16)}`)).toEqual({ ok: false, duvod: "nezname" });
    expect(sql(null, `select count(*) from public.audit_journal where action = 'knock_device_session_issued'
                      and metadata->>'kid' in ('${ceka}', '${odvolany}', '${vyprsely}')`)).toBe("0");
  });

  it.skipIf(!dbAvailable)("⛔ klient (ani účet samotného tabletu) si relaci vydat nesmí", () => {
    const kid = ohlasenyTablet();
    svc(`select public.admin_set_knock_device_approval('${kid}', true)`);
    const ucet = sql(null, `select ucet_id from public.knock_device_credentials where kid = '${kid}'`);
    expect(() => jakoKlient(randomUUID(), `select public.kiosk_vydej_relaci('${kid}')`)).toThrow(/permission denied/);
    expect(() => jakoKlient(ucet, `select public.kiosk_vydej_relaci('${kid}')`)).toThrow(/permission denied/);
  });
});
