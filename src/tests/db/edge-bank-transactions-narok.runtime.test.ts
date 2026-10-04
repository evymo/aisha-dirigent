/**
 * edge_bank_transactions: platby páruje admin, pohyby z banky zapisuje služba.
 *
 * ⛔ NÁLEZ 2026-10-04 (revize SQL): funkce je SECURITY DEFINER s GRANT pro
 * `authenticated` (admin UI ji volá přímo), ale tělo se na roli neptalo.
 * Člen bez rolí si přímým /rpc/ mohl:
 *   - spárovat platbu na VLASTNÍ objednávku → orders.status = 'paid' zdarma,
 *   - vložit podvržený bankovní pohyb,
 *   - přečíst frontu nespárovaných plateb (čísla účtů, jména plátců).
 *
 * Každý případ nejdřív ukáže, že oprávněná identita akci PROVEDE — prázdno
 * či chyba u obou by znamenaly slepou sondu, ne držící stráž.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { isPgReachable } from "./test-env-probe";
import { ANON, SLUZBA, fixtura, jako, prihlaseny, zkus } from "./sonda-identity";

const RUN = randomUUID().slice(0, 8);
const ADMIN = randomUUID();
const CLEN = randomUUID();
const CIZI = randomUUID();
const OBJ_CLENA = randomUUID();
const OBJ_ADMIN = randomUUID();
const OBJ_CIZI = randomUUID();
const TX_CLEN = randomUUID();
const TX_ADMIN = randomUUID();
const TX_ZAHOD = randomUUID();
const OBJ_AUTO = randomUUID();
const OBJ_NEDOPLATEK = randomUUID();

const volani = (akce: string, payload: object) =>
  `SELECT public.edge_bank_transactions('${akce}', '${JSON.stringify(payload)}'::jsonb)::text`;
const stavObjednavky = (id: string) =>
  fixtura(`SELECT payment_status || '/' || status FROM public.orders WHERE id = '${id}'`);

describe.skipIf(!isPgReachable())("edge_bank_transactions: nárok podle akce", () => {
  beforeAll(() => {
    fixtura(`INSERT INTO aisha_auth.users (id, email) VALUES
               ('${ADMIN}', 'banka-admin-${RUN}@test.local'),
               ('${CLEN}',  'banka-clen-${RUN}@test.local'),
               ('${CIZI}',  'banka-cizi-${RUN}@test.local')
             ON CONFLICT (id) DO NOTHING`);
    fixtura(`INSERT INTO public.user_roles (user_id, role) VALUES
               ('${ADMIN}', 'admin'), ('${CLEN}', 'member'), ('${CIZI}', 'member')
             ON CONFLICT DO NOTHING`);
    fixtura(`INSERT INTO public.orders (id, user_id, total, payment_method, payment_status, status, variable_symbol) VALUES
               ('${OBJ_CLENA}', '${CLEN}',  990, 'bank_transfer', 'awaiting_transfer', 'pending', 'vs-clen-${RUN}'),
               ('${OBJ_ADMIN}', '${CLEN}',  990, 'bank_transfer', 'awaiting_transfer', 'pending', 'vs-admin-${RUN}'),
               ('${OBJ_CIZI}',  '${CIZI}',  990, 'bank_transfer', 'awaiting_transfer', 'pending', 'vs-cizi-${RUN}'),
               ('${OBJ_AUTO}',  '${CIZI}',  500, 'bank_transfer', 'awaiting_transfer', 'pending', 'vs-auto-${RUN}'),
               ('${OBJ_NEDOPLATEK}', '${CIZI}', 700, 'bank_transfer', 'awaiting_transfer', 'pending', 'vs-nedo-${RUN}')`);
    fixtura(`INSERT INTO public.bank_transactions (id, fio_transaction_id, amount, sender_account, sender_name, match_status) VALUES
               ('${TX_CLEN}',  'fio-clen-${RUN}',  990, '123456789/0100', 'Platce ${RUN}', 'unmatched'),
               ('${TX_ADMIN}', 'fio-admin-${RUN}', 990, '987654321/0300', 'Platce ${RUN}', 'unmatched'),
               ('${TX_ZAHOD}', 'fio-zahod-${RUN}', 5,   '111111111/0800', 'Omyl ${RUN}',   'unmatched')`);
  });

  it("⛔ člen si NEspáruje platbu na vlastní objednávku (zaplaceno zdarma)", () => {
    const chyba = zkus(prihlaseny(CLEN), volani("match_to_order", { transaction_id: TX_CLEN, order_id: OBJ_CLENA }));
    expect(chyba).toMatch(/Access denied/);
    expect(stavObjednavky(OBJ_CLENA), "objednávka se přepnula na zaplacenou").toBe("awaiting_transfer/pending");
    expect(fixtura(`SELECT match_status FROM public.bank_transactions WHERE id = '${TX_CLEN}'`)).toBe("unmatched");
  });

  it("admin párování provede a objednávka je zaplacená (kontrolní vzorek)", () => {
    expect(jako(prihlaseny(ADMIN), volani("match_to_order", { transaction_id: TX_ADMIN, order_id: OBJ_ADMIN })))
      .toContain('"ok": true');
    expect(fixtura(`SELECT match_status FROM public.bank_transactions WHERE id = '${TX_ADMIN}'`)).toBe("matched");
    // Přechod na 'paid' spouští handle_order_payment_completed. Do 2026-10-04 volal
    // record_audit_log s uuid místo text a celé párování spadlo i adminovi.
    expect(stavObjednavky(OBJ_ADMIN)).toBe("paid/paid");
    expect(fixtura(`SELECT count(*) FROM public.audit_journal WHERE entity_type = 'orders' AND entity_id = '${OBJ_ADMIN}'`))
      .toBe("1");
  });

  it("⛔ frontu nespárovaných (účty, jména plátců) čte admin, člen NE", () => {
    expect(jako(prihlaseny(ADMIN), volani("get_unmatched", {})), "admin nevidí fixturu — sonda je slepá")
      .toContain(`fio-clen-${RUN}`);
    expect(zkus(prihlaseny(CLEN), volani("get_unmatched", {}))).toMatch(/Access denied/);
  });

  it("⛔ bankovní pohyb zapíše jen služba — člen ani admin ne", () => {
    const pohyb = (id: string) => ({ fio_transaction_id: id, amount: "1", sender_name: `Podvrh ${RUN}` });
    const pocet = () => fixtura(`SELECT count(*) FROM public.bank_transactions WHERE sender_name = 'Podvrh ${RUN}'`);

    expect(zkus(prihlaseny(CLEN), volani("insert_transaction", pohyb(`fio-podvrh-c-${RUN}`)))).toMatch(/Access denied/);
    expect(zkus(prihlaseny(ADMIN), volani("insert_transaction", pohyb(`fio-podvrh-a-${RUN}`)))).toMatch(/Access denied/);
    expect(pocet()).toBe("0");

    expect(jako(SLUZBA, volani("insert_transaction", pohyb(`fio-sluzba-${RUN}`)))).toContain('"ok": true');
    expect(pocet()).toBe("1");
  });

  // ⛔ Do 2026-10-04 tyhle akce v SQL vůbec nebyly, ačkoli je volá admin UI
  // (useBankReconciliation) a svc-fio-bank — padaly na „Unsupported action".
  it("admin čte všechny pohyby a objednávky čekající na převod; člen ne", () => {
    const vse = jako(prihlaseny(ADMIN), volani("get_all", {}));
    expect(vse).toContain(`fio-zahod-${RUN}`);
    expect(vse).toContain('"match_type"');
    expect(jako(prihlaseny(ADMIN), volani("get_awaiting_orders", {}))).toContain(`vs-clen-${RUN}`);

    expect(zkus(prihlaseny(CLEN), volani("get_all", {}))).toMatch(/Access denied/);
    expect(zkus(prihlaseny(CLEN), volani("get_awaiting_orders", {}))).toMatch(/Access denied/);
  });

  it("admin zahodí omylový pohyb; člen ne", () => {
    const zahod = volani("dismiss_transaction", { transaction_id: TX_ZAHOD, notes: "omyl" });
    const stav = () => fixtura(`SELECT match_status FROM public.bank_transactions WHERE id = '${TX_ZAHOD}'`);

    expect(zkus(prihlaseny(CLEN), zahod)).toMatch(/Access denied/);
    expect(stav()).toBe("unmatched");

    expect(jako(prihlaseny(ADMIN), zahod)).toBe('{"ok": true}');
    expect(stav()).toBe("dismissed");
  });

  it("auto-párování podle VS: jen služba; přesná částka zaplatí, nedoplatek jde adminovi", () => {
    const vloz = (vs: string, castka: number) =>
      jako(SLUZBA, volani("insert_transaction", { fio_transaction_id: `fio-${vs}`, amount: String(castka), variable_symbol: vs }));
    const paruj = (vs: string, castka: number) => volani("auto_match_by_vs", { variable_symbol: vs, amount: castka });

    vloz(`vs-auto-${RUN}`, 500);
    expect(zkus(prihlaseny(CLEN), paruj(`vs-auto-${RUN}`, 500))).toMatch(/Access denied/);
    expect(zkus(prihlaseny(ADMIN), paruj(`vs-auto-${RUN}`, 500))).toMatch(/Access denied/);
    expect(stavObjednavky(OBJ_AUTO)).toBe("awaiting_transfer/pending");

    expect(jako(SLUZBA, paruj(`vs-auto-${RUN}`, 500))).toContain('"matched": true');
    expect(stavObjednavky(OBJ_AUTO)).toBe("paid/paid");

    vloz(`vs-nedo-${RUN}`, 600);
    expect(jako(SLUZBA, paruj(`vs-nedo-${RUN}`, 600))).toContain('"reason": "amount_mismatch"');
    expect(stavObjednavky(OBJ_NEDOPLATEK), "nedoplatek objednávku zaplatil").toBe("awaiting_transfer/pending");
    expect(fixtura(`SELECT match_status FROM public.bank_transactions WHERE fio_transaction_id = 'fio-vs-nedo-${RUN}'`))
      .toBe("amount_mismatch");
  });

  it("detail převodu k objednávce: vlastník ano, cizí člen nic", () => {
    expect(jako(prihlaseny(CLEN), volani("get_order_bank_transfer", { order_id: OBJ_CLENA })))
      .toContain(`vs-clen-${RUN}`);
    expect(jako(prihlaseny(CIZI), volani("get_order_bank_transfer", { order_id: OBJ_CLENA })))
      .toBe('{"row": null}');
  });

  it("anon nemá EXECUTE", () => {
    expect(zkus(ANON, volani("get_unmatched", {}))).toMatch(/permission denied for function edge_bank_transactions/);
  });
});
