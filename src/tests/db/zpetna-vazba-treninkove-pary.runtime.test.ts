/**
 * Zpětná vazba → trénovací páry (SELF_IMPROVEMENT_LOOP.md §3, K-02).
 *
 * ⛔ NAMĚŘENO 2026-09-28 na main 9087ef3df: process_feedback_to_training dávala
 * `input = NULL` do `training_examples.input text NOT NULL DEFAULT ''` a DPO řádku
 * nevyplnila `output` (NOT NULL). První vhodná zpětná vazba tak shodila CELOU dávku
 * (transakce se vrátí, nic se neoznačí jako zpracované) a každý další běh padl
 * znovu — z opravy uživatele nikdy nevznikl trénovací pár.
 *
 * Co se tu měří (pod službou, tak funkci volá n8n):
 *   1. oprava uživatele → preference_pair: chosen = oprava, rejected = původní
 *      odpověď, output = oprava, input = ''            ← kontrolní vzorek
 *   2. vysoké hodnocení bez opravy → instruction pár (output = odpověď)
 *   3. obě zpětné vazby označené jako zpracované; druhý běh nic nezdvojí
 *   4. vzniklé příklady jsou NEVALIDOVANÉ — do exportu se bez validace nedostanou
 *
 * Spouští se přes: npm run test:db:trenink-pary (throwaway DB z baseline + heals + seed)
 */
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

const RUN = randomUUID().slice(0, 8);
const UZIVATEL = randomUUID();
const DATASET = randomUUID();
const KONVERZACE = randomUUID();
const OTAZKA_1 = randomUUID();
const ODPOVED_1 = randomUUID();
const OTAZKA_2 = randomUUID();
const ODPOVED_2 = randomUUID();
const VAZBA_OPRAVA = randomUUID();
const VAZBA_POCHVALA = randomUUID();

const DB_SLIBENA = Boolean(process.env.AISHA_DB_URL);

function psql(claims: string, sql: string): string {
  return execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tA"],
    {
      input: `\\o /dev/null\nSET request.jwt.claims = '${claims}';\n\\o\n${sql};`,
      encoding: "utf-8",
      env: { ...process.env, PGPASSWORD: PG_PASSWORD },
      stdio: ["pipe", "pipe", "pipe"],
    },
  ).trim();
}

const svc = (sql: string) => psql('{"role":"service_role"}', sql);

type Davka = { success: boolean; sft_pairs: number; dpo_pairs: number; skipped: number };
const zpracuj = (): Davka =>
  JSON.parse(
    svc(`SELECT public.process_feedback_to_training('${DATASET}', ARRAY['${VAZBA_OPRAVA}', '${VAZBA_POCHVALA}']::uuid[])::text`),
  ) as Davka;

type Priklad = { example_type: string; input: string; output: string; chosen: string | null; rejected: string | null; is_validated: boolean };
function priklad(vazba: string): Priklad {
  return JSON.parse(
    svc(`SELECT row_to_json(t)::text FROM (
           SELECT example_type, input, output, chosen, rejected, is_validated
           FROM public.training_examples WHERE source_id = '${vazba}' AND source_type = 'ai_feedback') t`),
  ) as Priklad;
}

describe.skipIf(!isPgReachable() && !DB_SLIBENA)("zpětná vazba vytvoří trénovací páry (K-02)", () => {
  let prvni: Davka;

  beforeAll(() => {
    if (!isPgReachable()) {
      throw new Error("AISHA_DB_URL je nastavená, ale DB nejde dosáhnout — sonda NESMÍ skončit přeskočením");
    }
    svc(`INSERT INTO aisha_auth.users (id, email) VALUES ('${UZIVATEL}', 'trenink-${RUN}@test.local') ON CONFLICT (id) DO NOTHING`);
    svc(`INSERT INTO public.training_datasets (id, name, source_type) VALUES ('${DATASET}', 'k02 ${RUN}', 'feedback')`);
    svc(`INSERT INTO public.chat_conversations (id, user_id) VALUES ('${KONVERZACE}', '${UZIVATEL}')`);
    svc(`INSERT INTO public.chat_messages (id, conversation_id, role, content, created_at) VALUES
           ('${OTAZKA_1}',  '${KONVERZACE}', 'user',      'Jak se jmenuje hlavní město?', now() - interval '4 minutes'),
           ('${ODPOVED_1}', '${KONVERZACE}', 'assistant', 'Brno.',                        now() - interval '3 minutes'),
           ('${OTAZKA_2}',  '${KONVERZACE}', 'user',      'Kolik je dva a dva?',          now() - interval '2 minutes'),
           ('${ODPOVED_2}', '${KONVERZACE}', 'assistant', 'Čtyři.',                       now() - interval '1 minute')`);
    svc(`INSERT INTO public.ai_feedback (id, user_id, conversation_id, message_id, rating, correction_text) VALUES
           ('${VAZBA_OPRAVA}',   '${UZIVATEL}', '${KONVERZACE}', '${ODPOVED_1}', 1, 'Hlavní město je Praha, ne Brno.'),
           ('${VAZBA_POCHVALA}', '${UZIVATEL}', '${KONVERZACE}', '${ODPOVED_2}', 5, NULL)`);
    prvni = zpracuj();
  });

  afterAll(() => {
    if (!isPgReachable()) return;
    svc(`DELETE FROM public.training_datasets WHERE id = '${DATASET}'`);
    svc(`DELETE FROM public.ai_feedback WHERE id IN ('${VAZBA_OPRAVA}', '${VAZBA_POCHVALA}')`);
    svc(`DELETE FROM public.chat_messages WHERE conversation_id = '${KONVERZACE}'`);
    svc(`DELETE FROM public.chat_conversations WHERE id = '${KONVERZACE}'`);
  });

  it("oprava uživatele → preference_pair: chosen = oprava, rejected = původní odpověď (kontrolní vzorek)", () => {
    expect(prvni).toMatchObject({ success: true, dpo_pairs: 1, sft_pairs: 1 });
    expect(priklad(VAZBA_OPRAVA)).toMatchObject({
      example_type: "preference_pair",
      input: "",
      chosen: "Hlavní město je Praha, ne Brno.",
      rejected: "Brno.",
      output: "Hlavní město je Praha, ne Brno.",
    });
  });

  it("vysoké hodnocení bez opravy → instruction pár s odpovědí jako výstupem", () => {
    expect(priklad(VAZBA_POCHVALA)).toMatchObject({ example_type: "instruction", input: "", output: "Čtyři.", chosen: null });
  });

  it("zpětná vazba je zpracovaná a druhý běh nic nezdvojí", () => {
    expect(svc(`SELECT count(*) FROM public.ai_feedback WHERE id IN ('${VAZBA_OPRAVA}', '${VAZBA_POCHVALA}') AND is_processed`)).toBe("2");
    const druhy = zpracuj();
    expect(druhy.sft_pairs + druhy.dpo_pairs).toBe(0);
    expect(svc(`SELECT count(*) FROM public.training_examples WHERE dataset_id = '${DATASET}'`)).toBe("2");
  });

  it("příklady vznikají nevalidované — bez validace se do exportu nedostanou", () => {
    expect(priklad(VAZBA_OPRAVA).is_validated).toBe(false);
    expect(priklad(VAZBA_POCHVALA).is_validated).toBe(false);
  });
});
