/**
 * Zpětná vazba jen na vlastní zprávu — a ta skutečně dotekne (SELF_IMPROVEMENT_LOOP.md §3, K-16).
 *
 * ⛔ NAMĚŘENO 2026-09-29 na main 9087ef3df: submit_ai_feedback byla SECURITY INVOKER,
 * ale chat_messages má jedinou čtecí politiku — pro správce. Běžný uživatel neviděl
 * ani VLASTNÍ zprávu, conversation_id zůstal NULL a process_feedback_to_training takovou
 * zpětnou vazbu vždy přeskočila: zpětná vazba uživatelů se NIKDY nestala trénovacím
 * párem. Funkce zároveň přijala od volajícího libovolné message_id / run_id — jakmile by
 * dráha fungovala, šlo by „opravovat" cizí odpovědi a otrávit trénovací data.
 *
 * Co se tu měří (pod skutečnou rolí authenticated — RLS platí):
 *   1. vlastník hodnotí odpověď asistenta ve své konverzaci → konverzace i běh se
 *      dohledají (bez toho pár nikdy nevznikne)                ← kontrolní vzorek
 *   2. cizí na cizí zprávu → „Message not found", nic se nezapíše
 *   3. neexistující zpráva → táž chyba (žádné orákulum)
 *   4. vlastní zpráva UŽIVATELE (ne asistenta) → táž chyba
 *   5. cizí běh bez zprávy → run_id se nepřevezme
 *   6. anonym → bez grantu
 *
 * Spouští se přes: npm run test:db:zpetna-vazba (throwaway DB z baseline + heals + seed)
 */
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

const RUN = randomUUID().slice(0, 8);
const VLASTNIK = randomUUID();
const CIZI = randomUUID();
const STORY = randomUUID();
const BEH = randomUUID();
const KONVERZACE = randomUUID();
const OTAZKA = randomUUID();
const ODPOVED = randomUUID();

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

type Odpoved = { ok: true; out: { success: boolean; feedback_id: string; run_id: string | null } } | { ok: false; err: string };

function hodnot(uid: string | null, argumenty: string): Odpoved {
  const claims = uid ? `{"sub":"${uid}","role":"authenticated"}` : '{"role":"anon"}';
  try {
    const out = psql(claims, `SELECT public.submit_ai_feedback(${argumenty})::text`, uid ? "authenticated" : "anon");
    return { ok: true, out: JSON.parse(out) };
  } catch (e) {
    return { ok: false, err: String((e as { stderr?: string }).stderr ?? e) };
  }
}

const pocetVazeb = (uid: string) => Number(svc(`SELECT count(*) FROM public.ai_feedback WHERE user_id = '${uid}'`));

describe.skipIf(!isPgReachable() && !DB_SLIBENA)("zpětná vazba jen na vlastní zprávu (K-16)", () => {
  beforeAll(() => {
    if (!isPgReachable()) {
      throw new Error("AISHA_DB_URL je nastavená, ale DB nejde dosáhnout — sonda NESMÍ skončit přeskočením");
    }
    svc(`INSERT INTO aisha_auth.users (id, email) VALUES
           ('${VLASTNIK}', 'vazba-vlastnik-${RUN}@test.local'),
           ('${CIZI}',     'vazba-cizi-${RUN}@test.local')
         ON CONFLICT (id) DO NOTHING`);
    svc(`INSERT INTO public.partner_stories (id, user_id, title, status) VALUES ('${STORY}', '${VLASTNIK}', 'vazba ${RUN}', 'active')`);
    svc(`INSERT INTO public.ai_runs (id, kind, story_id, actor_user_id) VALUES ('${BEH}', 'chat', '${STORY}', '${VLASTNIK}')`);
    svc(`INSERT INTO public.chat_conversations (id, user_id) VALUES ('${KONVERZACE}', '${VLASTNIK}')`);
    svc(`INSERT INTO public.chat_messages (id, conversation_id, role, content, content_metadata, created_at) VALUES
           ('${OTAZKA}', '${KONVERZACE}', 'user',      'Otázka?',  '{}'::jsonb, now() - interval '2 minutes'),
           ('${ODPOVED}', '${KONVERZACE}', 'assistant', 'Odpověď.', '{"aisha_run_id":"${BEH}"}'::jsonb, now() - interval '1 minute')`);
  });

  afterAll(() => {
    if (!isPgReachable()) return;
    svc(`DELETE FROM public.ai_feedback WHERE user_id IN ('${VLASTNIK}', '${CIZI}')`);
    svc(`DELETE FROM public.chat_messages WHERE conversation_id = '${KONVERZACE}'`);
    svc(`DELETE FROM public.chat_conversations WHERE id = '${KONVERZACE}'`);
    svc(`DELETE FROM public.ai_runs WHERE id = '${BEH}'`);
    svc(`DELETE FROM public.partner_stories WHERE id = '${STORY}'`);
  });

  it("vlastník hodnotí vlastní odpověď asistenta → konverzace i běh se dohledají (kontrolní vzorek)", () => {
    const r = hodnot(VLASTNIK, `p_message_id => '${ODPOVED}', p_rating => 1::smallint, p_correction_text => 'Správně je to jinak, takhle.'`);
    expect(r.ok, r.ok ? "" : r.err).toBe(true);
    const id = r.ok ? r.out.feedback_id : "";
    expect(r.ok && r.out.run_id).toBe(BEH);
    expect(svc(`SELECT conversation_id FROM public.ai_feedback WHERE id = '${id}'`), "bez konverzace pár nikdy nevznikne").toBe(KONVERZACE);
  });

  it("cizí na cizí zprávu → Message not found, nic se nezapíše", () => {
    const r = hodnot(CIZI, `p_message_id => '${ODPOVED}', p_rating => 1::smallint, p_correction_text => 'otrávená oprava cizí odpovědi'`);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.err).toMatch(/Message not found/);
    expect(pocetVazeb(CIZI)).toBe(0);
  });

  it("neexistující zpráva → táž chyba (žádné orákulum)", () => {
    const r = hodnot(CIZI, `p_message_id => '${randomUUID()}', p_rating => 1::smallint`);
    expect(!r.ok && r.err).toMatch(/Message not found/);
  });

  it("vlastní zpráva UŽIVATELE (ne odpověď asistenta) → táž chyba", () => {
    const r = hodnot(VLASTNIK, `p_message_id => '${OTAZKA}', p_rating => 5::smallint`);
    expect(!r.ok && r.err).toMatch(/Message not found/);
  });

  it("cizí běh bez zprávy → run_id se nepřevezme", () => {
    const r = hodnot(CIZI, `p_run_id => '${BEH}', p_rating => 5::smallint`);
    expect(r.ok, r.ok ? "" : r.err).toBe(true);
    expect(r.ok && r.out.run_id).toBeNull();
  });

  it("anonym → bez grantu", () => {
    const r = hodnot(null, `p_message_id => '${ODPOVED}', p_rating => 5::smallint`);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.err).toMatch(/permission denied/);
  });
});
