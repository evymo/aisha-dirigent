/**
 * SECURITY DEFINER funkce se SUBJEKTEM odpovídá jen o volajícím — CHOVÁNÍ.
 *
 * ⛔ NAMĚŘENO 2026-09-19 na guru: PostgREST vystavuje definer predikáty jako
 * `/rpc/<jméno>` a ony pravdivě odpovídaly o CIZÍM uuid — `has_role` dokonce
 * s veřejným anon klíčem (200). Třídu staticky hlídá brána
 * `src/tests/gates/definer-subjekt-jen-volajici.gate.test.ts`; ta ale pozná jen
 * TVAR stráže. Tady se měří, co funkce skutečně vydá kterému volajícímu:
 *
 *   cizí přihlášený (X)  → o subjektu se nedozví nic (false / prázdno / 42501)
 *   anonym               → nic (funkci nesmí spustit, nebo false)
 *   subjekt sám          → pravdu o sobě      ← KONTROLNÍ VZOREK
 *   služba (service_role)→ pravdu o komkoli   ← on-behalf-of volající zůstávají
 *   správa (admin)       → pravdu o komkoli (u auth-first funkcí jen o sobě)
 *   RLS                  → legitimní volající vidí své řádky dál
 *
 * ⛔ KONTROLNÍ VZOREK JE POVINNÝ. `false` u cizího znamená „drží" JEN tehdy, když
 * tatáž funkce nad týmiž daty vrátí `true` subjektu samotnému — jinak by test
 * prošel i nad prázdnou databází (sonda slepá, ne zelená). Proto každý případ
 * nejdřív tvrdí pravdu pro vlastníka a teprve pak nic pro cizího.
 *
 * Spouští se přes: npm run test:db:subjekt (throwaway DB z baseline + heals + seed)
 */
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

const RUN = randomUUID().slice(0, 8);
const ADMIN = randomUUID();
const CLEN = randomUUID(); // subjekt: účastník story, člen s členstvím, dává souhlas partnerovi
const PARTNER = randomUUID(); // má souhlas od CLEN, je výrobní poskytovatel
const CIZI = randomUUID(); // přihlášený bez rolí a bez vazeb — ten, kdo se ptá na cizí
const STORY = randomUUID();
const STORY2 = randomUUID();
const BEH = randomUUID();
const AKCE = `orakulum-${RUN}`;

/** Wrapper throwaway DB nastaví AISHA_DB_URL — pak je nedosažitelná DB vada, ne důvod přeskočit. */
const DB_SLIBENA = Boolean(process.env.AISHA_DB_URL);

function psql(claims: string, sql: string, role?: string): string {
  const setRole = role ? `SET ROLE ${role};\n` : "";
  return execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tA"],
    {
      input: `\\o /dev/null\nSET request.jwt.claims = '${claims}';\n${setRole}\\o\n${sql};`,
      encoding: "utf-8",
      env: { ...process.env, PGPASSWORD: PG_PASSWORD },
      stdio: ["pipe", "pipe", "pipe"],
    },
  ).trim();
}

const svc = (sql: string) => psql('{"role":"service_role"}', sql);

/** Odpověď identity přes skutečnou roli PostgREST (RLS i granty platí). */
function jako(uid: string | null, volani: string): { ok: true; out: string } | { ok: false; err: string } {
  const claims = uid ? `{"sub":"${uid}","role":"authenticated"}` : '{"role":"anon"}';
  try {
    return { ok: true, out: psql(claims, `SELECT (public.${volani})::text`, uid ? "authenticated" : "anon") };
  } catch (e) {
    return { ok: false, err: String((e as { stderr?: string }).stderr ?? e) };
  }
}
/**
 * Služba = volání pod service JWT (claims role=service_role). Bez `SET ROLE`:
 * stráž čte claims, ne DB roli, a většina těchto funkcí grant pro service_role
 * nemá — v provozu je služba volá zevnitř jiné definer funkce (práva vlastníka).
 * Grant je jiná otázka než stráž; tady se měří stráž.
 */
function sluzba(volani: string): string {
  return psql('{"role":"service_role"}', `SELECT (public.${volani})::text`);
}
/** Čtení tabulky pod identitou — měří RLS legitimního volajícího. */
function pocetJako(uid: string, sql: string): number {
  return Number(psql(`{"sub":"${uid}","role":"authenticated"}`, sql, "authenticated"));
}

/** „Nic se nedozvěděl": false, prázdné pole, nebo odmítnutí (42501 / bez práva spustit). */
function nicSeNedozvedel(r: ReturnType<typeof jako>): boolean {
  if (!r.ok) return /permission denied|Unauthorized|42501/i.test(r.err);
  return r.out === "false" || r.out === "{}" || r.out === "";
}

describe.skipIf(!isPgReachable() && !DB_SLIBENA)("definer se subjektem odpovídá jen o volajícím", () => {
  beforeAll(() => {
    if (!isPgReachable()) {
      throw new Error("AISHA_DB_URL je nastavená, ale DB nejde dosáhnout — sonda NESMÍ skončit přeskočením");
    }
    svc(`INSERT INTO aisha_auth.users (id, email) VALUES
           ('${ADMIN}',   'subjekt-admin-${RUN}@test.local'),
           ('${CLEN}',    'subjekt-clen-${RUN}@test.local'),
           ('${PARTNER}', 'subjekt-partner-${RUN}@test.local'),
           ('${CIZI}',    'subjekt-cizi-${RUN}@test.local')
         ON CONFLICT (id) DO NOTHING`);
    // Role admin musí nést is_admin (seed ji zakládá; bez seedu ji založíme).
    svc(`INSERT INTO public.roles (name, display_name, is_admin) VALUES ('admin', 'Administrator', true)
         ON CONFLICT (name) DO NOTHING`);
    svc(`INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin') ON CONFLICT DO NOTHING`);
    svc(`INSERT INTO public.role_permissions (role, section, permission) VALUES ('admin', 'members', 'read')
         ON CONFLICT DO NOTHING`);

    // Story graf: CLEN je účastníkem STORY, z ní vede přijatý odkaz na STORY2, v ní běh.
    svc(`INSERT INTO public.partner_stories (id, user_id, title, status) VALUES
           ('${STORY}',  '${CLEN}', 'subjekt ${RUN} A', 'active'),
           ('${STORY2}', '${ADMIN}', 'subjekt ${RUN} B', 'active')`);
    svc(`INSERT INTO public.story_participants (story_id, user_id, role) VALUES ('${STORY}', '${CLEN}', 'owner')`);
    svc(`INSERT INTO public.story_links (source_story_id, target_story_id, link_type, is_accepted)
         VALUES ('${STORY}', '${STORY2}', 'related_to', true)`);
    svc(`INSERT INTO public.ai_runs (id, kind, story_id) VALUES ('${BEH}', 'chat', '${STORY}')`);

    // Souhlas: CLEN sdílí data s PARTNERem; PARTNER je výrobní poskytovatel.
    svc(`INSERT INTO public.partner_profiles (user_id, display_name, city, is_production_provider)
         VALUES ('${PARTNER}', 'Partner ${RUN}', 'Brno', true)`);
    svc(`INSERT INTO public.data_sharing_consents (user_id, partner_id)
         SELECT '${CLEN}', pp.id FROM public.partner_profiles pp WHERE pp.user_id = '${PARTNER}'`);
    svc(`INSERT INTO public.member_health_states (user_id, name_key) VALUES ('${CLEN}', 'subjekt-${RUN}')`);

    // Odměny a chat: CLEN má aktivní členství; pravidlo odměny členství vyžaduje.
    svc(`INSERT INTO public.memberships (user_id, status) VALUES ('${CLEN}', 'active') ON CONFLICT (user_id) DO NOTHING`);
    svc(`INSERT INTO public.token_reward_rules (action_type, token_type, requires_membership, is_active)
         VALUES ('${AKCE}', 'PLATFORM', true, true)`);
    // Automatické schválení objednávky jen pro roli admin.
    svc(`INSERT INTO public.order_approval_rules (name, required_role, is_active, priority)
         VALUES ('${AKCE}', 'admin', true, 100000)`);
  });

  // Úklid: throwaway DB sdílí VŠECHNY testy jednoho běhu test:db. Bez úklidu tu zbyly řádky
  // v memberships / data_sharing_consents / token_reward_rules a schema-validation-v2
  // („tabulky musí být v seedu PRÁZDNÉ") pak padal podle pořadí souborů (naměřeno 2026-09-26).
  afterAll(() => {
    if (!isPgReachable()) return;
    svc(`DELETE FROM public.token_reward_rules WHERE action_type = '${AKCE}'`);
    svc(`DELETE FROM public.order_approval_rules WHERE name = '${AKCE}'`);
    svc(`DELETE FROM public.memberships WHERE user_id = '${CLEN}'`);
    svc(`DELETE FROM public.data_sharing_consents WHERE user_id = '${CLEN}'`);
    svc(`DELETE FROM public.member_health_states WHERE user_id = '${CLEN}' AND name_key = 'subjekt-${RUN}'`);
  });

  /**
   * Predikáty: vlastník dostane pravdu (kontrolní vzorek), cizí přihlášený
   * a anonym nic, služba pravdu o subjektu.
   */
  const PREDIKATY: Array<{ jmeno: string; subjekt: () => string; volani: () => string }> = [
    { jmeno: "is_story_participant", subjekt: () => CLEN, volani: () => `is_story_participant('${CLEN}', '${STORY}')` },
    {
      jmeno: "has_data_sharing_consent",
      subjekt: () => PARTNER,
      volani: () => `has_data_sharing_consent('${CLEN}', '${PARTNER}')`,
    },
    {
      jmeno: "can_access_linked_story",
      subjekt: () => CLEN,
      volani: () => `can_access_linked_story('${CLEN}', '${STORY}', '${STORY2}')`,
    },
    { jmeno: "fn_user_can_read_run", subjekt: () => CLEN, volani: () => `fn_user_can_read_run('${CLEN}', '${BEH}')` },
    { jmeno: "user_can_chat", subjekt: () => CLEN, volani: () => `user_can_chat('${CLEN}')` },
    { jmeno: "user_has_admin_role", subjekt: () => ADMIN, volani: () => `user_has_admin_role('${ADMIN}')` },
    { jmeno: "is_user_admin", subjekt: () => ADMIN, volani: () => `is_user_admin('${ADMIN}')` },
    {
      jmeno: "should_auto_approve_order",
      subjekt: () => ADMIN,
      volani: () => `should_auto_approve_order('${ADMIN}', 10)`,
    },
    { jmeno: "is_professional_partner", subjekt: () => PARTNER, volani: () => `is_professional_partner('${PARTNER}')` },
    {
      jmeno: "can_access_admin_section",
      subjekt: () => ADMIN,
      volani: () => `can_access_admin_section('members', '${ADMIN}')`,
    },
  ];

  for (const p of PREDIKATY) {
    it(`⛔ ${p.jmeno}: subjekt pravdu o sobě, cizí přihlášený ani anonym nic`, () => {
      const sam = jako(p.subjekt(), p.volani());
      // Kontrolní vzorek: bez něj by „false u cizího" prošlo i nad prázdnou DB.
      expect(sam, `${p.jmeno}: subjekt se o sobě nedozví pravdu — sonda je slepá, ne zelená`).toEqual({
        ok: true,
        out: "true",
      });

      const cizi = jako(CIZI, p.volani());
      expect(nicSeNedozvedel(cizi), `${p.jmeno}: cizí přihlášený se dozvěděl o subjektu: ${JSON.stringify(cizi)}`).toBe(
        true,
      );

      const anon = jako(null, p.volani());
      expect(nicSeNedozvedel(anon), `${p.jmeno}: anonym se dozvěděl o subjektu: ${JSON.stringify(anon)}`).toBe(true);
    });

    it(`⭐ ${p.jmeno}: služba se smí ptát na kohokoli (on-behalf-of volající zůstávají)`, () => {
      expect(sluzba(p.volani())).toBe("true");
    });
  }

  it("⭐ správa se smí ptát na cizí subjekt u stráže „sám, nebo služba/správa\"", () => {
    for (const volani of [
      `is_story_participant('${CLEN}', '${STORY}')`,
      `fn_user_can_read_run('${CLEN}', '${BEH}')`,
      `user_can_chat('${CLEN}')`,
    ]) {
      expect(jako(ADMIN, volani), volani).toEqual({ ok: true, out: "true" });
    }
  });

  it("⛔ get_user_sections: cizí dostane prázdno, vlastník své sekce", () => {
    const sam = jako(ADMIN, `get_user_sections('${ADMIN}')`);
    expect(sam.ok && sam.out.includes("members"), `kontrolní vzorek: ${JSON.stringify(sam)}`).toBe(true);
    const cizi = jako(CIZI, `get_user_sections('${ADMIN}')`);
    expect(cizi, "cizí přihlášený vyčetl sekce (= role) admina").toEqual({ ok: true, out: "{}" });
    expect(sluzba(`get_user_sections('${ADMIN}')`)).toContain("members");
  });

  it("⛔ can_receive_reward: cizí dostane 42501, vlastník rozhodnutí o sobě", () => {
    const volani = `can_receive_reward('${CLEN}', '${AKCE}', 'PLATFORM')`;
    const sam = jako(CLEN, volani);
    expect(sam.ok && /"can_receive": true/.test(sam.out), `kontrolní vzorek: ${JSON.stringify(sam)}`).toBe(true);
    // Rozdíl, který dřív vynášel členství cizího účtu: CIZI sám o sobě členství nemá.
    const ciziOSobe = jako(CIZI, `can_receive_reward('${CIZI}', '${AKCE}', 'PLATFORM')`);
    expect(ciziOSobe.ok && /Membership requirement not met/.test(ciziOSobe.out), JSON.stringify(ciziOSobe)).toBe(true);
    const cizi = jako(CIZI, volani);
    expect(cizi.ok, `cizí se dozvěděl o členství subjektu: ${JSON.stringify(cizi)}`).toBe(false);
    expect(nicSeNedozvedel(cizi)).toBe(true);
    expect(sluzba(volani)).toMatch(/"can_receive": true/);
  });

  it("⛔ has_data_sharing_consent: cizí dotaz nezapíše audit pod jménem partnera", () => {
    const pocet = () =>
      Number(
        svc(`SELECT count(*) FROM public.audit_journal
             WHERE user_id = '${PARTNER}' AND action = 'has_data_sharing_consent'`),
      );
    const pred = pocet();
    jako(CIZI, `has_data_sharing_consent('${CLEN}', '${PARTNER}')`);
    expect(pocet(), "cizí dotaz podvrhl auditní záznam „partner ověřoval přístup\"").toBe(pred);
    // Kontrolní vzorek: vlastní dotaz partnera audit zapíše (měřidlo počítá správně).
    jako(PARTNER, `has_data_sharing_consent('${CLEN}', '${PARTNER}')`);
    expect(pocet()).toBe(pred + 1);
  });

  it("⛔ insert_audit_journal_entry: za cizí jméno smí psát jen služba", () => {
    const pocet = (uid: string) =>
      Number(svc(`SELECT count(*) FROM public.audit_journal WHERE user_id = '${uid}' AND action = '${AKCE}'`));
    const zaCizi = jako(CIZI, `insert_audit_journal_entry('${AKCE}', '{}'::jsonb, '${ADMIN}')`);
    expect(zaCizi.ok, `přihlášený zapsal audit pod jménem admina: ${JSON.stringify(zaCizi)}`).toBe(false);
    expect(pocet(ADMIN)).toBe(0);
    // Za sebe (výchozí p_user_id) — mobilní appka tak píše dál.
    expect(jako(CIZI, `insert_audit_journal_entry('${AKCE}', '{}'::jsonb)`).ok).toBe(true);
    expect(pocet(CIZI)).toBe(1);
    // Služba za kohokoli (toolExecutor, n8n).
    sluzba(`insert_audit_journal_entry('${AKCE}', '{}'::jsonb, '${ADMIN}')`);
    expect(pocet(ADMIN)).toBe(1);
  });

  /**
   * ⭐ DRUHÝ SMĚR: stráž nesmí zavřít dveře RLS. Politiky volají predikáty právy
   * volajícího s `auth.uid()` — legitimní volající musí své řádky vidět dál,
   * cizí dál nevidí nic.
   */
  it("⭐ RLS story_links (is_story_participant): účastník vidí odkaz, cizí ne", () => {
    const sql = `SELECT count(*) FROM public.story_links WHERE source_story_id = '${STORY}'`;
    expect(pocetJako(CLEN, sql), "účastník přišel o svůj odkaz — stráž zavřela RLS").toBe(1);
    expect(pocetJako(CIZI, sql)).toBe(0);
  });

  it("⭐ RLS member_health_states (has_data_sharing_consent): partner se souhlasem vidí, cizí ne", () => {
    const sql = `SELECT count(*) FROM public.member_health_states WHERE user_id = '${CLEN}'`;
    expect(pocetJako(PARTNER, sql), "partner se souhlasem přišel o data — stráž zavřela RLS").toBe(1);
    expect(pocetJako(CLEN, sql), "vlastník nevidí svůj stav").toBe(1);
    expect(pocetJako(CIZI, sql)).toBe(0);
  });
});
