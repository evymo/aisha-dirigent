/**
 * moderate_development_flow vrací pravidla podle SKUTEČNÝCH kategorií — pro každý session_type.
 *
 * ⛔ NAMĚŘENO 2026-09-14: funkce porovnávala enum expert_rule_category s literály,
 * které v enumu nejsou ('testing', 'quality', 'compliance', …) → 22P02 každému
 * volajícímu. MCP nástroje moderate_flow / suggest_next_step / check_pr_compliance
 * nad ní nefungovaly nikde. Mapování (rozhodnuto 2026-09-14):
 *   compliance = pravidla připnutá ke story (story_rulesets.rule_ids), severity error
 *                u pr_review / pre_commit, do výběru bez ohledu na kategorii
 *   quality    = coding_standard + performance_optimization
 *
 * Fixture zakládá jedno publikované pravidlo na kategorii, aby výsledek nezávisel
 * na profilu seedu; slug „000-…“ je řadí před seed, takže je LIMIT 30 neodřízne. Běží pod rolí authenticated s claims, v transakci s ROLLBACK.
 *
 * Spouští se přes: npm run test:db:moderace (throwaway DB se seedem)
 */
import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "crypto";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable } from "./test-env-probe";

const dbAvailable = isPgReachable();
const RUN = randomUUID().slice(0, 8);
const UZIVATEL = randomUUID();
const STORY = randomUUID();
const RULESET = randomUUID();
const PRIPNUTE = randomUUID();

/** Očekávané kategorie výběru (null = všechna publikovaná pravidla). */
const MAPA: Record<string, string[] | null> = {
  test_strategy: ["testing_strategy", "coding_standard", "performance_optimization"],
  pr_review: ["coding_standard", "performance_optimization", "security_practice", "testing_strategy"],
  pre_commit: ["coding_standard", "performance_optimization", "security_practice"],
  architecture: ["architecture_pattern", "integration_pattern", "data_modeling"],
  chat_flow: null,
  estimation: null,
};
const KATEGORIE_FIXTURE = [
  "testing_strategy", "coding_standard", "performance_optimization",
  "security_practice", "architecture_pattern", "integration_pattern", "data_modeling",
];

type Pravidlo = { slug: string; category: string; severity: string; pinned: boolean };
const vysledky: Record<string, Pravidlo[]> = {};

beforeAll(() => {
  if (!dbAvailable) return;
  const pravidla = KATEGORIE_FIXTURE.map(
    (k) => `('${randomUUID()}', '000-mf-${RUN}-${k}', 'mf ${k}', 'tělo', '${k}', 'published', '${randomUUID()}')`,
  ).join(",\n  ");
  const volani = Object.keys(MAPA).flatMap((typ) => [
    `SELECT 'R|${typ}|bez|' || (public.moderate_development_flow('${typ}')->'rules')::text;`,
    `SELECT 'R|${typ}|story|' || (public.moderate_development_flow('${typ}', '${STORY}')->'rules')::text;`,
  ]);

  const vystup = psqlMultiline(`
\\set ON_ERROR_STOP on
BEGIN;
-- Fixture je operátorská (jako seed): triggery na expert_rules (propagace pravidel)
-- vyžadují admin/staff nebo service_role. Funkce se pak volá jako běžný uživatel.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
INSERT INTO aisha_auth.users (id, email) VALUES ('${UZIVATEL}', 'mf-${RUN}@test.local');
INSERT INTO public.partner_stories (id, title, status, origin, user_id)
  VALUES ('${STORY}', 'mf ${RUN}', 'inbox', 'manual', '${UZIVATEL}');
INSERT INTO public.expert_rules (id, slug, title, body_markdown, category, status, author_partner_id) VALUES
  ${pravidla},
  ('${PRIPNUTE}', '000-mf-${RUN}-pripnute', 'mf připnuté', 'tělo', 'documentation_standard', 'published', '${randomUUID()}');
INSERT INTO public.story_rulesets (id, story_id, ruleset_fingerprint, rule_ids, rule_versions)
  VALUES ('${RULESET}', '${STORY}', 'mf-${RUN}', ARRAY['${PRIPNUTE}']::uuid[], '{}'::jsonb);
INSERT INTO public.story_contexts (story_id, ruleset_id) VALUES ('${STORY}', '${RULESET}');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"${UZIVATEL}","role":"authenticated"}', true);
\\t on
\\a on
${volani.join("\n")}
ROLLBACK;
`);
  for (const radek of vystup.split("\n").filter((l) => l.startsWith("R|"))) {
    const [, typ, varianta, json] = radek.split("|", 4);
    vysledky[`${typ}|${varianta}`] = JSON.parse(radek.slice(`R|${typ}|${varianta}|`.length) || json);
  }
}, 120_000);

const moje = (p: Pravidlo[]) => p.filter((r) => r.slug.startsWith(`000-mf-${RUN}-`));

describe.skipIf(!dbAvailable)("moderate_development_flow — kategorie a compliance (runtime)", () => {
  it("každý session_type × (bez story, se story) vrátil výsledek", () => {
    expect(Object.keys(vysledky).sort()).toEqual(
      Object.keys(MAPA).flatMap((t) => [`${t}|bez`, `${t}|story`]).sort(),
    );
  });

  it.each(Object.keys(MAPA))("%s vrací pravidla jen ze svých kategorií", (typ) => {
    const pravidla = vysledky[`${typ}|bez`];
    expect(pravidla.length, `${typ} nevrátil žádné pravidlo`).toBeGreaterThan(0);
    const mapa = MAPA[typ];
    if (mapa) {
      expect(pravidla.filter((r) => !mapa.includes(r.category)), "pravidla mimo mapování").toEqual([]);
      // fixture má pravidlo pro každou mapovanou kategorii → všechny musí dorazit
      expect(moje(pravidla).map((r) => r.category).sort()).toEqual([...mapa].sort());
    }
  });

  it("bez story nic není připnuté a error má jen security_practice", () => {
    for (const typ of Object.keys(MAPA)) {
      const pravidla = vysledky[`${typ}|bez`];
      expect(pravidla.some((r) => r.pinned), typ).toBe(false);
      expect(pravidla.filter((r) => r.severity === "error" && r.category !== "security_practice"), typ).toEqual([]);
    }
  });

  it.each(["pr_review", "pre_commit"])("%s se story: připnuté pravidlo je ve výběru mimo své kategorie, první a s error", (typ) => {
    const pravidla = vysledky[`${typ}|story`];
    const pripnute = pravidla.find((r) => r.slug === `000-mf-${RUN}-pripnute`);
    expect(pripnute).toMatchObject({ category: "documentation_standard", pinned: true, severity: "error" });
    expect(pravidla[0].slug).toBe(`000-mf-${RUN}-pripnute`);
  });

  it.each(["test_strategy", "architecture"])("%s se story: připnuté pravidlo mimo kategorie do výběru nepatří (compliance jen u review/commit)", (typ) => {
    expect(vysledky[`${typ}|story`].some((r) => r.slug === `000-mf-${RUN}-pripnute`)).toBe(false);
  });
});
