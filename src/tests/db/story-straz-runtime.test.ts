/**
 * Stráž story u pěti story-scoped RPC na SKUTEČNÉ databázi — matice identit.
 *
 * ⛔ NAMĚŘENO 2026-09-14: transition_story_delivery_status, get_allowed_transitions,
 * moderate_development_flow, mcp_get_compliance_context a generate_copilot_instructions
 * byly SECURITY DEFINER s GRANT authenticated a bez kontroly story — cizí
 * přihlášený četl kontext/ruleset cizí story a měnil její delivery_status.
 * Stráž je jeden predikát `can_access_story` (aisha/db/sql/functions/can_access_story.sql).
 *
 * Měří se pod rolí `authenticated` / `service_role` s `request.jwt.claims` — pod
 * superuserem by stráž neřekla nic. Každé volání běží v podtransakci a zapíše
 * SQLSTATE (nebo 'ok'); celý běh končí ROLLBACK, po testu nezůstane stopa.
 *
 * Spouští se přes: node scripts/db/with-throwaway-db.mjs -- npx vitest run <tento soubor>
 */
import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "crypto";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable } from "./test-env-probe";

const dbAvailable = isPgReachable();
const RUN = randomUUID().slice(0, 8);
const ID = {
  vlastnik: randomUUID(),
  clen: randomUUID(),
  divak: randomUUID(),
  cizi: randomUUID(),
  admin: randomUUID(),
};
const STORY = randomUUID();
const NEEXISTUJICI = randomUUID();
const START = `rt_start_${RUN}`;
const CIL = `rt_done_${RUN}`;

type Identita = keyof typeof ID | "service_role" | "bez_sub";
const IDENTITY: Identita[] = ["service_role", "admin", "vlastnik", "clen", "divak", "cizi", "bez_sub"];
const FUNKCE = [
  "transition_story_delivery_status",
  "get_allowed_transitions",
  "moderate_development_flow",
  "mcp_get_compliance_context",
  "generate_copilot_instructions",
] as const;
type Funkce = (typeof FUNKCE)[number];

/** Nastavení role a claims pro identitu — uvnitř DO bloku přes set_config(…, true). */
function prepni(identita: Identita): string {
  if (identita === "service_role") {
    return `PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true); PERFORM set_config('role', 'service_role', true);`;
  }
  const claims = identita === "bez_sub" ? `{"role":"authenticated"}` : `{"sub":"${ID[identita]}","role":"authenticated"}`;
  return `PERFORM set_config('request.jwt.claims', '${claims}', true); PERFORM set_config('role', 'authenticated', true);`;
}

const volani = (story: string): Record<Funkce, string> => ({
  transition_story_delivery_status: `v_r := public.transition_story_delivery_status('${story}', '${CIL}', 'runtime-test', '{}'::jsonb); v_zapsano := coalesce((v_r->>'success')::boolean, false);`,
  get_allowed_transitions: `PERFORM * FROM public.get_allowed_transitions('${story}');`,
  moderate_development_flow: `PERFORM public.moderate_development_flow('chat_flow', '${story}');`,
  mcp_get_compliance_context: `PERFORM public.mcp_get_compliance_context('${story}');`,
  generate_copilot_instructions: `PERFORM public.generate_copilot_instructions('${story}');`,
});

/** Jeden krok matice: identita × funkce × story → SQLSTATE nebo 'ok' (u přechodu i zda se zapsal). */
function krok(identita: Identita, fn: Funkce, story: string, klic: string): string {
  return `
  ${prepni(identita)}
  v_zapsano := NULL;
  BEGIN
    ${volani(story)[fn]}
    v_stav := 'ok';
  EXCEPTION WHEN OTHERS THEN
    v_stav := SQLSTATE;
  END;
  PERFORM set_config('role', v_orig, true);
  INSERT INTO pg_temp.straz_vysledky VALUES ('${klic}', v_stav, v_zapsano);
  UPDATE public.partner_stories SET delivery_status = '${START}' WHERE id = '${STORY}';`;
}

type Vysledek = { stav: string; zapsano: boolean | null };
let matice: Record<string, Vysledek> = {};

beforeAll(() => {
  if (!dbAvailable) return;
  const kroky: string[] = [];
  for (const identita of IDENTITY) {
    for (const fn of FUNKCE) kroky.push(krok(identita, fn, STORY, `${identita}|${fn}|story`));
  }
  for (const identita of ["cizi", "admin"] as const) {
    for (const fn of FUNKCE) kroky.push(krok(identita, fn, NEEXISTUJICI, `${identita}|${fn}|neexistujici`));
  }

  const vystup = psqlMultiline(`
\\set ON_ERROR_STOP on
BEGIN;
INSERT INTO aisha_auth.users (id, email) VALUES
  ('${ID.vlastnik}', 'straz-vlastnik-${RUN}@test.local'),
  ('${ID.clen}', 'straz-clen-${RUN}@test.local'),
  ('${ID.divak}', 'straz-divak-${RUN}@test.local'),
  ('${ID.cizi}', 'straz-cizi-${RUN}@test.local'),
  ('${ID.admin}', 'straz-admin-${RUN}@test.local');
INSERT INTO public.user_roles (user_id, role) VALUES ('${ID.admin}', 'admin');
INSERT INTO public.partner_stories (id, title, status, origin, user_id, delivery_status)
  VALUES ('${STORY}', 'straz runtime ${RUN}', 'inbox', 'manual', '${ID.vlastnik}', '${START}');
INSERT INTO public.story_participants (story_id, user_id, role) VALUES
  ('${STORY}', '${ID.clen}', 'member'),
  ('${STORY}', '${ID.divak}', 'viewer');
-- Explicitní id: seed vkládá pravidla s pevnými id 1–54 a sekvenci neposouvá, takže
-- nextval() na čerstvé DB koliduje s pkey (naměřeno 2026-09-14, vada seedu mimo tento test).
INSERT INTO public.delivery_transition_rules (id, from_status, to_status, requires_role, is_active)
  SELECT coalesce(max(id), 0) + 1, '${START}', '${CIL}', NULL, true FROM public.delivery_transition_rules;
CREATE TEMP TABLE straz_vysledky (klic text, stav text, zapsano boolean);
DO $$
DECLARE
  v_orig text := current_user;
  v_stav text;
  v_r jsonb;
  v_zapsano boolean;
BEGIN
${kroky.join("\n")}
END $$;
\\t on
\\a on
SELECT 'MATICE=' || json_object_agg(klic, json_build_object('stav', stav, 'zapsano', zapsano))::text FROM pg_temp.straz_vysledky;
ROLLBACK;
`);
  const radek = vystup.split("\n").find((l) => l.startsWith("MATICE="));
  if (!radek) throw new Error(`matice nevznikla — výstup psql:\n${vystup}`);
  matice = JSON.parse(radek.slice("MATICE=".length));
}, 120_000);

const stav = (identita: Identita, fn: Funkce, story = "story") => matice[`${identita}|${fn}|${story}`];

describe.skipIf(!dbAvailable)("stráž story (runtime, matice identit)", () => {
  it("matice je úplná (jinak by testy níže měřily prázdno)", () => {
    expect(Object.keys(matice)).toHaveLength(IDENTITY.length * FUNKCE.length + 2 * FUNKCE.length);
  });

  it.each(["admin", "vlastnik", "clen"] as const)("%s projde stráží u všech pěti funkcí", (identita) => {
    for (const fn of FUNKCE) expect(stav(identita, fn).stav, `${identita} → ${fn}`).toBe("ok");
  });

  it("service_role projde stráží; moderate_development_flow ho odmítá už dřív (vyžaduje auth.uid(), mimo stráž)", () => {
    for (const fn of FUNKCE.filter((f) => f !== "moderate_development_flow")) {
      expect(stav("service_role", fn).stav, fn).toBe("ok");
    }
    expect(stav("service_role", "moderate_development_flow").stav).toBe("42501");
  });

  it.each(["admin", "vlastnik", "clen"] as const)("%s přechod opravdu zapíše", (identita) => {
    expect(stav(identita, "transition_story_delivery_status").zapsano).toBe(true);
  });

  it("divák čte (4 čtecí funkce), ale přechod nezapíše → 42501", () => {
    for (const fn of FUNKCE.filter((f) => f !== "transition_story_delivery_status")) {
      expect(stav("divak", fn).stav, fn).toBe("ok");
    }
    expect(stav("divak", "transition_story_delivery_status").stav).toBe("42501");
  });

  it.each(["cizi", "bez_sub"] as const)("%s neprojde u žádné funkce → 42501", (identita) => {
    for (const fn of FUNKCE) expect(stav(identita, fn).stav, `${identita} → ${fn}`).toBe("42501");
  });

  it("cizí u neexistující story dostane totéž 42501 (stráž není orákulum existence)", () => {
    for (const fn of FUNKCE) expect(stav("cizi", fn, "neexistujici").stav, fn).toBe("42501");
  });

  it("admin u neexistující story projde stráží a narazí až na dohledání (P0002 tam, kde funkce story vyžaduje)", () => {
    for (const fn of ["transition_story_delivery_status", "get_allowed_transitions", "generate_copilot_instructions"] as const) {
      expect(stav("admin", fn, "neexistujici").stav, fn).toBe("P0002");
    }
    expect(stav("admin", "mcp_get_compliance_context", "neexistujici").stav).toBe("ok");
  });
});
