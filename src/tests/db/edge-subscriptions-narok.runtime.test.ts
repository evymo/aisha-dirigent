/**
 * edge_subscriptions: předplatné zapisuje služba, číst ho smí vlastník.
 *
 * ⛔ NÁLEZ 2026-10-04 (revize SQL): funkce je SECURITY DEFINER s GRANT pro
 * `authenticated` (svc-stripe čte předplatné uživatelským tokenem), ale tělo
 * se na roli neptalo. Přihlášený člen si přímým /rpc/ mohl:
 *   - přepnout VLASTNÍ předplatné na 'active' bez platby (update_subscription),
 *   - založit si předplatné libovolného balíčku (create_member_subscription),
 *   - přepsat Stripe ceny balíčku (update_package_stripe),
 *   - číst předplatné cizího účtu (get_user_subscriptions s cizím user_id).
 *
 * Kontrolní vzorek ke každé zamítnuté akci: služba ji PROVEDE.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isPgReachable } from "./test-env-probe";
import { ANON, SLUZBA, fixtura, jako, prihlaseny, zkus } from "./sonda-identity";

const RUN = randomUUID().slice(0, 8);
const ADMIN = randomUUID();
const CLEN = randomUUID();
const CIZI = randomUUID();
const BALICEK = randomUUID();
const PRED_CLENA = randomUUID();
const PRED_CIZI = randomUUID();

const volani = (akce: string, payload: object) =>
  `SELECT public.edge_subscriptions('${akce}', '${JSON.stringify(payload)}'::jsonb)::text`;
const stav = (id: string) => fixtura(`SELECT status FROM public.member_subscriptions WHERE id = '${id}'`);

describe.skipIf(!isPgReachable())("edge_subscriptions: nárok podle akce", () => {
  beforeAll(() => {
    fixtura(`INSERT INTO aisha_auth.users (id, email) VALUES
               ('${ADMIN}', 'predplatne-admin-${RUN}@test.local'),
               ('${CLEN}',  'predplatne-clen-${RUN}@test.local'),
               ('${CIZI}',  'predplatne-cizi-${RUN}@test.local')
             ON CONFLICT (id) DO NOTHING`);
    fixtura(`INSERT INTO public.user_roles (user_id, role) VALUES
               ('${ADMIN}', 'admin'), ('${CLEN}', 'member'), ('${CIZI}', 'member')
             ON CONFLICT DO NOTHING`);
    fixtura(`INSERT INTO public.subscription_packages (id, name, slug, price, stripe_price_id_recurring)
             VALUES ('${BALICEK}', 'Balíček ${RUN}', 'balicek-${RUN}', 990, 'price_puvodni_${RUN}')`);
    fixtura(`INSERT INTO public.member_subscriptions (id, user_id, package_id, status) VALUES
               ('${PRED_CLENA}', '${CLEN}', '${BALICEK}', 'pending_payment'),
               ('${PRED_CIZI}',  '${CIZI}', '${BALICEK}', 'active')`);
  });

  // Úklid: celá sada sdílí jednu DB a schema-validation-v2 hlídá, že projektové
  // tabulky (PROJEKTOVE_TABULKY) zůstanou po seedu PRÁZDNÉ.
  afterAll(() => {
    fixtura(`DELETE FROM public.member_subscriptions WHERE package_id = '${BALICEK}'`);
    fixtura(`DELETE FROM public.subscription_packages WHERE id = '${BALICEK}'`);
  });

  it("⛔ člen si NEaktivuje vlastní předplatné bez platby", () => {
    const aktivuj = volani("update_subscription", { id: PRED_CLENA, status: "active" });
    expect(zkus(prihlaseny(CLEN), aktivuj)).toMatch(/Access denied/);
    expect(stav(PRED_CLENA), "předplatné se aktivovalo bez platby").toBe("pending_payment");

    // Kontrolní vzorek: služba (svc-stripe po potvrzení u Stripe) aktivaci zapíše.
    expect(jako(SLUZBA, aktivuj)).toContain('"updated": true');
    expect(stav(PRED_CLENA)).toBe("active");
  });

  it("⛔ člen ani admin si NEzaloží předplatné — zakládá ho checkout služby", () => {
    const zaloz = (uid: string) =>
      volani("create_member_subscription", { user_id: uid, package_id: BALICEK, status: "active" });
    const pocet = () => fixtura(`SELECT count(*) FROM public.member_subscriptions WHERE package_id = '${BALICEK}'`);

    expect(zkus(prihlaseny(CLEN), zaloz(CLEN))).toMatch(/Access denied/);
    expect(zkus(prihlaseny(ADMIN), zaloz(CLEN))).toMatch(/Access denied/);
    expect(pocet()).toBe("2");

    expect(jako(SLUZBA, zaloz(CLEN))).toContain('"ok": true');
    expect(pocet()).toBe("3");
  });

  it("⛔ člen NEpřepíše Stripe cenu balíčku", () => {
    const prepis = volani("update_package_stripe", { package_id: BALICEK, stripe_price_id_recurring: `price_podvrh_${RUN}` });
    const cena = () => fixtura(`SELECT stripe_price_id_recurring FROM public.subscription_packages WHERE id = '${BALICEK}'`);

    expect(zkus(prihlaseny(CLEN), prepis)).toMatch(/Access denied/);
    expect(cena()).toBe(`price_puvodni_${RUN}`);

    expect(jako(SLUZBA, prepis)).toContain('"updated": true');
    expect(cena()).toBe(`price_podvrh_${RUN}`);
  });

  it("⛔ předplatné čte vlastník, služba a admin — cizí člen NE", () => {
    const cti = volani("get_user_subscriptions", { user_id: CIZI });
    expect(jako(prihlaseny(CIZI), cti), "vlastník nevidí své předplatné — sonda je slepá").toContain(PRED_CIZI);
    expect(jako(SLUZBA, cti)).toContain(PRED_CIZI);
    expect(jako(prihlaseny(ADMIN), cti)).toContain(PRED_CIZI);
    expect(zkus(prihlaseny(CLEN), cti)).toMatch(/Access denied/);
  });

  it("katalog balíčků zůstává čitelný přihlášenému", () => {
    expect(jako(prihlaseny(CLEN), volani("get_package_by_id", { package_id: BALICEK }))).toContain(`balicek-${RUN}`);
  });

  it("anon nemá EXECUTE", () => {
    expect(zkus(ANON, volani("get_package_by_id", { package_id: BALICEK })))
      .toMatch(/permission denied for function edge_subscriptions/);
  });
});
