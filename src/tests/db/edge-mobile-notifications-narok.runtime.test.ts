/**
 * edge_mobile_notifications: push a notifikace obsluhuje služba, ne přihlášený.
 *
 * ⛔ NÁLEZ 2026-10-04 (revize SQL): funkce je SECURITY DEFINER s GRANT pro
 * `authenticated` (admin UI čte doručení kampaně) a stráž měla jen tahle
 * jediná admin akce. Kdokoli přihlášený si přímým /rpc/ mohl:
 *   - přečíst FCM tokeny cizích zařízení (push komukoli mimo platformu),
 *   - poslat in-app notifikaci s libovolným odkazem jinému účtu (phishing),
 *   - vynulovat push tokeny VŠEM uživatelům naráz (bez user_id),
 *   - číst preference notifikací cizích účtů.
 *
 * Kontrolní vzorek ke každé zamítnuté akci: služba (svc-push) ji provede.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { isPgReachable } from "./test-env-probe";
import { ANON, SLUZBA, fixtura, jako, prihlaseny, zkus } from "./sonda-identity";

const RUN = randomUUID().slice(0, 8);
const ADMIN = randomUUID();
const UTOCNIK = randomUUID();
const OBET = randomUUID();
const TOKEN = `fcm-obet-${RUN}`;
const KAMPAN = `kampan-${RUN}`;

const volani = (akce: string, payload: object) =>
  `SELECT public.edge_mobile_notifications('${akce}', '${JSON.stringify(payload)}'::jsonb)::text`;
const tokenObeti = () =>
  fixtura(`SELECT coalesce(fcm_token, 'NULL') FROM public.mobile_sessions WHERE user_id = '${OBET}'`);

describe.skipIf(!isPgReachable())("edge_mobile_notifications: nárok podle akce", () => {
  beforeAll(() => {
    fixtura(`INSERT INTO aisha_auth.users (id, email) VALUES
               ('${ADMIN}',   'push-admin-${RUN}@test.local'),
               ('${UTOCNIK}', 'push-utocnik-${RUN}@test.local'),
               ('${OBET}',    'push-obet-${RUN}@test.local')
             ON CONFLICT (id) DO NOTHING`);
    fixtura(`INSERT INTO public.user_roles (user_id, role) VALUES
               ('${ADMIN}', 'admin'), ('${UTOCNIK}', 'member'), ('${OBET}', 'member')
             ON CONFLICT DO NOTHING`);
    fixtura(`INSERT INTO public.mobile_sessions (user_id, device_platform, app_version, device_id, fcm_token)
             VALUES ('${OBET}', 'android', '1.0.0', 'zarizeni-${RUN}', '${TOKEN}')`);
    fixtura(`INSERT INTO public.notifications (user_id, title, type, metadata)
             VALUES ('${OBET}', 'Kampaň ${RUN}', 'campaign', '{"campaign_id": "${KAMPAN}"}'::jsonb)`);
  });

  it("⛔ FCM token cizího zařízení přihlášený NEpřečte", () => {
    const cti = volani("get_mobile_sessions", { user_ids: [OBET] });
    expect(jako(SLUZBA, cti), "služba nevidí fixturu — sonda je slepá").toContain(TOKEN);
    expect(zkus(prihlaseny(UTOCNIK), cti)).toMatch(/Access denied/);
  });

  it("⛔ přihlášený NEpošle notifikaci s odkazem jinému účtu", () => {
    const posli = volani("insert_notifications_bulk", {
      rows: [{ user_id: OBET, title: `Ověřte účet ${RUN}`, link: "https://phish.example/login" }],
    });
    const pocet = () => fixtura(`SELECT count(*) FROM public.notifications WHERE title = 'Ověřte účet ${RUN}'`);

    expect(zkus(prihlaseny(UTOCNIK), posli)).toMatch(/Access denied/);
    expect(pocet()).toBe("0");

    // Kontrolní vzorek: služba (svc-push kampaně) notifikaci vloží. Do 2026-10-04
    // akce padala pro všechny na „WITH … INSERT musí být na nejvyšší úrovni".
    expect(jako(SLUZBA, posli)).toBe('{"inserted": 1}');
    expect(pocet()).toBe("1");
  });

  it("⛔ přihlášený NEvynuluje push tokeny všem", () => {
    expect(zkus(prihlaseny(UTOCNIK), volani("null_mobile_session_token", {}))).toMatch(/Access denied/);
    expect(tokenObeti(), "token oběti zmizel").toBe(TOKEN);

    // Kontrolní vzorek: služba neplatný token oběti zneplatní (svc-push po 404 od FCM).
    jako(SLUZBA, volani("null_mobile_session_token", { user_id: OBET, fcm_token: TOKEN }));
    expect(tokenObeti()).toBe("NULL");
  });

  it("⛔ preference cizích účtů a dedupe klíče přihlášený NEčte, auditní log nezapíše", () => {
    expect(zkus(prihlaseny(UTOCNIK), volani("get_notification_preferences", { user_ids: [OBET] }))).toMatch(/Access denied/);
    expect(zkus(prihlaseny(UTOCNIK), volani("get_existing_questionnaire_reminder_keys", { user_ids: [OBET] })))
      .toMatch(/Access denied/);
    expect(zkus(prihlaseny(UTOCNIK), volani("insert_notification_log", { title: `log-${RUN}` }))).toMatch(/Access denied/);
    expect(jako(SLUZBA, volani("insert_notification_log", { title: `log-${RUN}` }))).toContain('"ok": true');
  });

  it("doručení kampaně čte admin; člen ne (stráž admin akce zůstává)", () => {
    const cti = volani("get_campaign_notification_deliveries_admin", { campaign_id: KAMPAN });
    expect(jako(prihlaseny(ADMIN), cti), "admin nevidí doručení — sonda je slepá").toContain(`Kampaň ${RUN}`);
    expect(zkus(prihlaseny(UTOCNIK), cti)).toMatch(/Access denied/);
  });

  it("anon nemá EXECUTE", () => {
    expect(zkus(ANON, volani("get_mobile_sessions", { user_ids: [OBET] })))
      .toMatch(/permission denied for function edge_mobile_notifications/);
  });
});
