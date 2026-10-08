/**
 * edge_payment_sessions('insert'): platební relace checkoutu se opravdu zapíše.
 *
 * ⛔ NÁLEZ 2026-10-07 (WP-C): `reference_id` je v tabulce uuid, akce do něj vkládala
 * text z payloadu (`NULLIF(p_payload ->> 'reference_id', '')`). text → uuid nemá
 * přiřazovací přetypování, takže zápis relace padal při KAŽDÉM checkoutu
 * (svc-stripe /checkout volá insert uživatelským tokenem pro sebe).
 *
 * Kontrolní vzorek: člen relaci pro SEBE zapíše; pro cizí user_id ne (stráž
 * dispečera beze změny).
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { isPgReachable } from "./test-env-probe";
import { fixtura, jako, prihlaseny, zkus } from "./sonda-identity";

const RUN = randomUUID().slice(0, 8);
const CLEN = randomUUID();
const CIZI = randomUUID();
const OBJ = randomUUID();

const vloz = (uzivatel: string, reference: string) =>
  `SELECT public.edge_payment_sessions('insert', '${JSON.stringify({
    amount: 990,
    currency: "CZK",
    reference_id: reference,
    reference_type: "order",
    session_type: "order_checkout",
    status: "pending",
    stripe_session_id: `cs_${RUN}_${uzivatel.slice(0, 4)}`,
    user_id: uzivatel,
  })}'::jsonb)::text`;

describe.skipIf(!isPgReachable())("edge_payment_sessions: insert relace checkoutu", () => {
  beforeAll(() => {
    fixtura(`INSERT INTO aisha_auth.users (id, email) VALUES
               ('${CLEN}', 'platba-clen-${RUN}@test.local'),
               ('${CIZI}', 'platba-cizi-${RUN}@test.local')
             ON CONFLICT (id) DO NOTHING`);
    fixtura(`INSERT INTO public.user_roles (user_id, role) VALUES ('${CLEN}', 'member'), ('${CIZI}', 'member')
             ON CONFLICT DO NOTHING`);
  });

  it("člen zapíše relaci pro sebe a reference_id je uložené jako uuid objednávky", () => {
    expect(jako(prihlaseny(CLEN), vloz(CLEN, OBJ))).toContain('"ok": true');
    expect(fixtura(`SELECT count(*) FROM public.payment_sessions WHERE reference_id = '${OBJ}' AND user_id = '${CLEN}'`))
      .toBe("1");
  });

  it("⛔ relaci za cizí účet člen nezapíše", () => {
    expect(zkus(prihlaseny(CLEN), vloz(CIZI, randomUUID()))).toMatch(/Access denied/);
    expect(fixtura(`SELECT count(*) FROM public.payment_sessions WHERE user_id = '${CIZI}'`)).toBe("0");
  });
});
