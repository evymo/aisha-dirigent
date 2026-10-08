/**
 * SECURITY DEFINER dispečery edge_* — každá akce se ptá na nárok (runtime).
 *
 * ⛔ NAMĚŘENO 2026-10-06 (main 0f992f647, opraveno jen ve GitHub stagingu 10-04):
 * funkce mají GRANT pro authenticated, ale část akcí se nikoho na nic neptala.
 * Přihlášený člen (registrace je otevřená → „authenticated" = kdokoli) si
 * přímým /rpc/:
 *   - edge_bank_transactions: označil VLASTNÍ objednávku za zaplacenou, vložil
 *     falešný bankovní pohyb, přečetl účty a jména plátců;
 *   - edge_subscriptions: aktivoval si předplatné bez platby, četl cizí předplatné;
 *   - edge_mobile_notifications: četl cizí push tokeny, posílal notifikace komukoli,
 *     vynuloval tokeny všem;
 *   - edge_blockchain_audit: vložil záznam do auditního řetězce;
 *   - edge_payment_sessions: přepsal stav cizí platební relace;
 *   - edge_public_partners_directory: četl auditní aktivitu cizího účtu.
 *
 * Statický protějšek (každá akce SE PTÁ): definer-dispecer-autorizuje-kazdou-akci.gate.
 * Tady se měří, co funkce SKUTEČNĚ udělá které identitě — anon, cizí přihlášený,
 * přihlášený bez sub, vlastník, správa, služba.
 *
 * ⛔ KONTROLNÍ VZORKY jsou povinné: každé „odmítnuto" má vedle sebe důkaz, že
 * TÁŽ akce projde tomu, komu patří (služba / správa / vlastník) — jinak by test
 * zeleně odkýval i „opravu" typu RAISE pro všechny, která rozbije svc-fio-bank,
 * svc-push, svc-stripe a admin UI.
 *
 * Běh: AISHA_TESTDB_POVINNA=1 npm run test:db:pohledy-edge
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isPgReachable } from "./test-env-probe";
import { ANON, BEZ_SUB, SLUZBA, fixtura, jako, prihlaseny, zkus } from "./sonda-identity";

const RUN = randomUUID().slice(0, 8);
const ADMIN = randomUUID();
const ALICE = randomUUID();
const BOB = randomUUID();
const OBJEDNAVKA = randomUUID();
const BALICEK = randomUUID();
const PREDPLATNE = randomUUID();
const VS = `9${Date.now().toString().slice(-8)}`;
const FIO = `fio-${RUN}`;
const TOKEN_BOB = `tok-bob-${RUN}`;
const RELACE_BOB = `cs_bob_${RUN}`;
const RELACE_ALICE = `cs_alice_${RUN}`;

const odmitnuto = /Access denied|permission denied for function/;
const volani = (fn: string, akce: string, payload: Record<string, unknown> = {}) =>
  `SELECT public.${fn}('${akce}', '${JSON.stringify(payload).replace(/'/g, "''")}'::jsonb)::text`;

describe.skipIf(!isPgReachable())("edge_* dispečery: nárok v každé akci", () => {
  beforeAll(() => {
    fixtura(`INSERT INTO aisha_auth.users (id, email) VALUES
               ('${ADMIN}', 'edge-admin-${RUN}@test.local'), ('${ALICE}', 'edge-alice-${RUN}@test.local'),
               ('${BOB}', 'edge-bob-${RUN}@test.local')
             ON CONFLICT (id) DO NOTHING`);
    fixtura(`INSERT INTO public.user_roles (user_id, role) VALUES
               ('${ADMIN}', 'admin'), ('${ALICE}', 'member'), ('${BOB}', 'member')
             ON CONFLICT DO NOTHING`);
    fixtura(`INSERT INTO public.orders (id, user_id, total, status, payment_status, variable_symbol)
             VALUES ('${OBJEDNAVKA}', '${ALICE}', 1234, 'pending', 'awaiting_transfer', '${VS}')`);
    fixtura(`INSERT INTO public.subscription_packages (id, name, slug, is_active)
             VALUES ('${BALICEK}', 'Balíček ${RUN}', 'balicek-${RUN}', true)`);
    fixtura(`INSERT INTO public.member_subscriptions (id, user_id, package_id, status)
             VALUES ('${PREDPLATNE}', '${ALICE}', '${BALICEK}', 'pending_payment')`);
    fixtura(`INSERT INTO public.mobile_sessions (user_id, device_platform, app_version, device_id, fcm_token)
             VALUES ('${BOB}', 'ios', '1.0.0', 'dev-${RUN}', '${TOKEN_BOB}')`);
    fixtura(`INSERT INTO public.notification_preferences (user_id) VALUES ('${BOB}') ON CONFLICT DO NOTHING`);
    fixtura(`INSERT INTO public.payment_sessions (user_id, stripe_session_id, session_type, reference_type, reference_id, status)
             VALUES ('${BOB}', '${RELACE_BOB}', 'order_checkout', 'order', '${OBJEDNAVKA}', 'pending')`);
    // Pohyb z banky zapisuje SLUŽBA (svc-fio-bank) — kontrolní vzorek zápisové cesty.
    expect(jako(SLUZBA, volani("edge_bank_transactions", "insert_transaction", {
      fio_transaction_id: FIO, amount: 1234, variable_symbol: VS, sender_name: `Plátce ${RUN}`, sender_account: "123/0100",
    }))).toContain('"ok": true');
  });

  // Celá sada sdílí jednu DB a schema-validation-v2 hlídá prázdné projektové tabulky po seedu.
  afterAll(() => {
    fixtura(`DELETE FROM public.bank_transactions WHERE fio_transaction_id = '${FIO}'`);
    fixtura(`DELETE FROM public.orders WHERE id = '${OBJEDNAVKA}'`);
    fixtura(`DELETE FROM public.member_subscriptions WHERE id = '${PREDPLATNE}'`);
    fixtura(`DELETE FROM public.subscription_packages WHERE id = '${BALICEK}'`);
    fixtura(`DELETE FROM public.mobile_sessions WHERE device_id = 'dev-${RUN}'`);
    fixtura(`DELETE FROM public.notification_preferences WHERE user_id = '${BOB}'`);
    fixtura(`DELETE FROM public.payment_sessions WHERE stripe_session_id IN ('${RELACE_BOB}', '${RELACE_ALICE}')`);
    fixtura(`DELETE FROM public.notification_logs WHERE title = 'sonda-${RUN}'`);
  });

  it("⛔ anon nemá EXECUTE na žádný z dispečerů", () => {
    for (const fn of ["edge_bank_transactions", "edge_subscriptions", "edge_mobile_notifications",
      "edge_blockchain_audit", "edge_payment_sessions", "edge_public_partners_directory"]) {
      expect(zkus(ANON, volani(fn, "x")), fn).toMatch(/permission denied for function/);
    }
  });

  describe("edge_bank_transactions", () => {
    const txId = () => fixtura(`SELECT id FROM public.bank_transactions WHERE fio_transaction_id = '${FIO}'`);

    it("⛔ člen si nezaplatí vlastní objednávku spárováním platby", () => {
      expect(zkus(prihlaseny(ALICE), volani("edge_bank_transactions", "match_to_order", {
        order_id: OBJEDNAVKA, transaction_id: txId(),
      }))).toMatch(odmitnuto);
      expect(fixtura(`SELECT payment_status || '/' || status FROM public.orders WHERE id = '${OBJEDNAVKA}'`))
        .toBe("awaiting_transfer/pending");
      expect(fixtura(`SELECT match_status FROM public.bank_transactions WHERE fio_transaction_id = '${FIO}'`)).toBe("unmatched");
    });

    it("⛔ člen nevloží bankovní pohyb a nečte frontu plátců; ani bez sub", () => {
      for (const kdo of [prihlaseny(ALICE), BEZ_SUB]) {
        expect(zkus(kdo, volani("edge_bank_transactions", "insert_transaction", { amount: 1, fio_transaction_id: `x-${RUN}` })))
          .toMatch(odmitnuto);
        expect(zkus(kdo, volani("edge_bank_transactions", "get_unmatched"))).toMatch(odmitnuto);
      }
      // Ani správa nevkládá pohyby — to je výhradně služba (svc-fio-bank).
      expect(zkus(prihlaseny(ADMIN), volani("edge_bank_transactions", "insert_transaction", { amount: 1, fio_transaction_id: `y-${RUN}` })))
        .toMatch(odmitnuto);
    });

    it("kontrolní vzorek: správa frontu vidí, vlastník vidí platební údaje SVÉ objednávky, cizí ne", () => {
      expect(jako(prihlaseny(ADMIN), volani("edge_bank_transactions", "get_unmatched")), "správa nevidí pohyb").toContain(`Plátce ${RUN}`);
      expect(jako(prihlaseny(ALICE), volani("edge_bank_transactions", "get_order_bank_transfer", { order_id: OBJEDNAVKA })))
        .toContain(VS);
      expect(jako(prihlaseny(BOB), volani("edge_bank_transactions", "get_order_bank_transfer", { order_id: OBJEDNAVKA })))
        .toBe('{"row": null}');
    });
  });

  describe("edge_subscriptions", () => {
    it("⛔ člen si neaktivuje předplatné bez platby a nic nezaloží ani nepřepíše", () => {
      expect(zkus(prihlaseny(ALICE), volani("edge_subscriptions", "update_subscription", { id: PREDPLATNE, status: "active" })))
        .toMatch(odmitnuto);
      expect(zkus(prihlaseny(ALICE), volani("edge_subscriptions", "create_member_subscription", {
        user_id: ALICE, package_id: BALICEK, status: "active",
      }))).toMatch(odmitnuto);
      expect(zkus(prihlaseny(ALICE), volani("edge_subscriptions", "update_package_stripe", {
        package_id: BALICEK, stripe_product_id: "prod_podvrh",
      }))).toMatch(odmitnuto);
      expect(fixtura(`SELECT status FROM public.member_subscriptions WHERE id = '${PREDPLATNE}'`)).toBe("pending_payment");
      expect(fixtura(`SELECT count(*) FROM public.member_subscriptions WHERE user_id = '${ALICE}'`)).toBe("1");
    });

    it("⛔ cizí předplatné nečte cizí člen ani token bez sub; vlastník a správa ano", () => {
      expect(zkus(prihlaseny(BOB), volani("edge_subscriptions", "get_user_subscriptions", { user_id: ALICE }))).toMatch(odmitnuto);
      expect(zkus(BEZ_SUB, volani("edge_subscriptions", "get_user_subscriptions", { user_id: ALICE }))).toMatch(odmitnuto);
      expect(jako(prihlaseny(ALICE), volani("edge_subscriptions", "get_user_subscriptions", { user_id: ALICE }))).toContain(PREDPLATNE);
      expect(jako(prihlaseny(ADMIN), volani("edge_subscriptions", "get_user_subscriptions", { user_id: ALICE }))).toContain(PREDPLATNE);
    });

    it("katalog balíčků čte kdokoli přihlášený (vědomě veřejná akce)", () => {
      expect(jako(prihlaseny(BOB), volani("edge_subscriptions", "get_package_by_id", { package_id: BALICEK }))).toContain(`balicek-${RUN}`);
    });

    it("kontrolní vzorek: aktivaci po ověření u Stripe zapíše služba (svc-stripe)", () => {
      expect(jako(SLUZBA, volani("edge_subscriptions", "update_subscription", { id: PREDPLATNE, status: "active" })))
        .toContain('"updated": true');
      expect(fixtura(`SELECT status FROM public.member_subscriptions WHERE id = '${PREDPLATNE}'`)).toBe("active");
    });
  });

  describe("edge_mobile_notifications", () => {
    it("⛔ člen nečte cizí push tokeny ani preference a nic nezapíše", () => {
      const r = zkus(prihlaseny(ALICE), volani("edge_mobile_notifications", "get_mobile_sessions", { user_ids: [BOB] }));
      expect(r).toMatch(odmitnuto);
      expect(r).not.toContain(TOKEN_BOB);
      for (const [akce, payload] of [
        ["get_notification_preferences", { user_ids: [BOB] }],
        ["insert_notifications_bulk", { rows: [{ user_id: BOB, title: "phish", link: "https://phish.example" }] }],
        ["insert_notification_log", { title: `sonda-${RUN}` }],
        ["get_existing_questionnaire_reminder_keys", { user_ids: [BOB], dedupe_keys: ["k"] }],
        ["null_mobile_session_token", {}],
      ] as const) {
        expect(zkus(prihlaseny(ALICE), volani("edge_mobile_notifications", akce, payload)), akce).toMatch(odmitnuto);
        expect(zkus(BEZ_SUB, volani("edge_mobile_notifications", akce, payload)), `${akce} bez sub`).toMatch(odmitnuto);
      }
      expect(fixtura(`SELECT fcm_token FROM public.mobile_sessions WHERE device_id = 'dev-${RUN}'`), "token vynulován").toBe(TOKEN_BOB);
    });

    it("⛔ doručení kampaně čte jen správa", () => {
      expect(zkus(prihlaseny(ALICE), volani("edge_mobile_notifications", "get_campaign_notification_deliveries_admin", { campaign_id: RUN })))
        .toMatch(odmitnuto);
      expect(jako(prihlaseny(ADMIN), volani("edge_mobile_notifications", "get_campaign_notification_deliveries_admin", { campaign_id: RUN })))
        .toContain('"rows"');
    });

    it("kontrolní vzorek: služba (svc-push) tokeny dostane", () => {
      expect(jako(SLUZBA, volani("edge_mobile_notifications", "get_mobile_sessions", { user_ids: [BOB] }))).toContain(TOKEN_BOB);
    });
  });

  describe("edge_blockchain_audit", () => {
    it("⛔ člen nezapíše do auditního řetězce ani nepočítá cizí aktivitu (nemá ani EXECUTE)", () => {
      expect(zkus(prihlaseny(ALICE), volani("edge_blockchain_audit", "insert_record", { event_type: "podvrh", payload_hash: "x" })))
        .toMatch(/permission denied for function/);
      expect(zkus(prihlaseny(ALICE), volani("edge_blockchain_audit", "count_requests", { user_id: BOB })))
        .toMatch(/permission denied for function/);
    });

    it("kontrolní vzorek: služba (svc-blockchain) projde", () => {
      expect(jako(SLUZBA, volani("edge_blockchain_audit", "count_requests", { user_id: BOB }))).toMatch(/"count": \d+/);
    });
  });

  describe("edge_payment_sessions", () => {
    it("⛔ člen nepřepíše stav cizí platební relace a nezaloží relaci za cizí účet", () => {
      expect(zkus(prihlaseny(ALICE), volani("edge_payment_sessions", "update_status", { stripe_session_id: RELACE_BOB, status: "completed" })))
        .toMatch(odmitnuto);
      expect(fixtura(`SELECT status FROM public.payment_sessions WHERE stripe_session_id = '${RELACE_BOB}'`)).toBe("pending");
      expect(zkus(prihlaseny(ALICE), volani("edge_payment_sessions", "insert", {
        user_id: BOB, stripe_session_id: `cs_podvrh_${RUN}`, session_type: "order_checkout", reference_type: "order", reference_id: OBJEDNAVKA,
      }))).toMatch(odmitnuto);
      expect(zkus(BEZ_SUB, volani("edge_payment_sessions", "insert", {
        user_id: BOB, stripe_session_id: `cs_podvrh2_${RUN}`, session_type: "order_checkout", reference_type: "order", reference_id: OBJEDNAVKA,
      }))).toMatch(odmitnuto);
    });

    it("kontrolní vzorek: stráž pustí člena k relaci ZA SEBE (svc-stripe checkout), služba mění stav", () => {
      // ⚠️ ZNÁMÁ VADA MIMO TUHLE VĚTEV (naměřeno 2026-10-06): akce `insert` padá KAŽDÉMU,
      // i službě — `NULLIF(p_payload ->> 'reference_id', '')` je text do sloupce uuid
      // („column reference_id is of type uuid but expression is of type text"), takže
      // svc-stripe checkout i subscription-checkout relaci nikdy nezapsaly. Tady se proto
      // měří jen to, za co odpovídá STRÁŽ: vlastní relaci člena neodmítne nárokem.
      // Po opravě castu musí projít úplně ('"ok": true') — obě podoby test přijme.
      const r = zkus(prihlaseny(ALICE), volani("edge_payment_sessions", "insert", {
        user_id: ALICE, stripe_session_id: RELACE_ALICE, session_type: "order_checkout", reference_type: "order", reference_id: OBJEDNAVKA,
      }));
      expect(r, "stráž odmítla členovi relaci za SEBE").not.toMatch(odmitnuto);
      expect(jako(SLUZBA, volani("edge_payment_sessions", "update_status", { stripe_session_id: RELACE_BOB, status: "expired" })))
        .toContain('"updated": true');
    });
  });

  describe("edge_public_partners_directory", () => {
    it("⛔ člen nečte auditní aktivitu cizího účtu ani otisku IP", () => {
      expect(zkus(prihlaseny(ALICE), volani("edge_public_partners_directory", "count_requests_authenticated", { user_id: BOB })))
        .toMatch(odmitnuto);
      expect(zkus(prihlaseny(ALICE), volani("edge_public_partners_directory", "count_requests_anonymous", { ip_hash: "x" })))
        .toMatch(odmitnuto);
    });

    it("veřejný adresář čte kdokoli přihlášený (vědomě veřejné akce), služba i počty", () => {
      expect(jako(prihlaseny(ALICE), volani("edge_public_partners_directory", "count_visible"))).toMatch(/"count": \d+/);
      expect(jako(prihlaseny(ALICE), volani("edge_public_partners_directory", "get_partners", { limit: 1 }))).toContain('"rows"');
      expect(jako(SLUZBA, volani("edge_public_partners_directory", "count_requests_authenticated", { user_id: BOB }))).toMatch(/"count": \d+/);
    });
  });
});
