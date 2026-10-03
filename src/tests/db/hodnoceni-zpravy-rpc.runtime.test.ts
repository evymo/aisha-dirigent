/**
 * Čtečky zprávy a zápis skóre pro hodnocení kvality odpovědí (SELF_IMPROVEMENT_LOOP.md §3, K-17).
 *
 * ⛔ NAMĚŘENO 2026-09-29 na main 9087ef3df: svc-ai-chat evaluate.ts volal
 * get_chat_message_by_id a get_preceding_user_message, které NEEXISTOVALY — každé
 * hodnocení odpovědi padlo dřív, než se soudce zeptal. update_message_eval_score měla
 * SoT, ale nebyla v heals.
 *
 * Co se tu měří:
 *   1. služba přečte zprávu (id, content, role, conversation_id)         ← kontrolní vzorek
 *   2. předchozí otázka = POSLEDNÍ zpráva uživatele PŘED hodnocenou odpovědí
 *   3. neexistující zpráva → NULL (route z toho dělá 404), ne chyba
 *   4. skóre se uloží ke zprávě
 *   5. přihlášený ani anonym čtečky nespustí (cizí zprávy čte jen služba)
 *
 * Spouští se přes: npm run test:db:hodnoceni-zpravy (throwaway DB z baseline + heals + seed)
 */
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

const RUN = randomUUID().slice(0, 8);
const UZIVATEL = randomUUID();
const KONVERZACE = randomUUID();
const OTAZKA_STARA = randomUUID();
const OTAZKA = randomUUID();
const ODPOVED = randomUUID();
const POZDEJSI = randomUUID();
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

const svc = (sql: string) => psql('{"role":"service_role"}', sql, "service_role");
const koren = (sql: string) => psql('{"role":"service_role"}', sql);

describe.skipIf(!isPgReachable() && !DB_SLIBENA)("čtečky zprávy pro hodnocení (K-17)", () => {
  beforeAll(() => {
    if (!isPgReachable()) {
      throw new Error("AISHA_DB_URL je nastavená, ale DB nejde dosáhnout — sonda NESMÍ skončit přeskočením");
    }
    koren(`INSERT INTO aisha_auth.users (id, email) VALUES ('${UZIVATEL}', 'hodnoceni-${RUN}@test.local') ON CONFLICT (id) DO NOTHING`);
    koren(`INSERT INTO public.chat_conversations (id, user_id) VALUES ('${KONVERZACE}', '${UZIVATEL}')`);
    koren(`INSERT INTO public.chat_messages (id, conversation_id, role, content, created_at) VALUES
           ('${OTAZKA_STARA}', '${KONVERZACE}', 'user',      'Stará otázka',  now() - interval '5 minutes'),
           ('${OTAZKA}',       '${KONVERZACE}', 'user',      'Ta otázka',     now() - interval '3 minutes'),
           ('${ODPOVED}',      '${KONVERZACE}', 'assistant', 'Ta odpověď',    now() - interval '2 minutes'),
           ('${POZDEJSI}',     '${KONVERZACE}', 'user',      'Pozdější dotaz', now() - interval '1 minute')`);
  });

  afterAll(() => {
    if (!isPgReachable()) return;
    koren(`DELETE FROM public.chat_messages WHERE conversation_id = '${KONVERZACE}'`);
    koren(`DELETE FROM public.chat_conversations WHERE id = '${KONVERZACE}'`);
  });

  it("služba přečte zprávu (kontrolní vzorek)", () => {
    const z = JSON.parse(svc(`SELECT public.get_chat_message_by_id('${ODPOVED}')::text`));
    expect(z).toEqual({ id: ODPOVED, content: "Ta odpověď", role: "assistant", conversation_id: KONVERZACE });
  });

  it("předchozí otázka = poslední zpráva uživatele PŘED odpovědí (ne starší, ne pozdější)", () => {
    const o = JSON.parse(svc(`SELECT public.get_preceding_user_message('${KONVERZACE}', '${ODPOVED}')::text`));
    expect(o).toEqual({ content: "Ta otázka" });
  });

  it("neexistující zpráva → NULL, ne chyba", () => {
    expect(svc(`SELECT public.get_chat_message_by_id('${randomUUID()}') IS NULL`)).toBe("t");
  });

  it("skóre se uloží ke zprávě", () => {
    svc(`SELECT public.update_message_eval_score('judge', 0.75, '{"relevance":1}'::jsonb, '${ODPOVED}')`);
    expect(koren(`SELECT eval_score->>'score_avg' FROM public.chat_messages WHERE id = '${ODPOVED}'`)).toBe("0.75");
  });

  it("přihlášený ani anonym čtečky nespustí", () => {
    for (const [claims, role] of [[`{"sub":"${UZIVATEL}","role":"authenticated"}`, "authenticated"], ['{"role":"anon"}', "anon"]]) {
      expect(() => psql(claims, `SELECT public.get_chat_message_by_id('${ODPOVED}')`, role)).toThrow(/permission denied/);
      expect(() => psql(claims, `SELECT public.get_preceding_user_message('${KONVERZACE}', '${ODPOVED}')`, role)).toThrow(/permission denied/);
    }
  });
});
