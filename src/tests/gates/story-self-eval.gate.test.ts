/**
 * Story Self-Evaluation Lens — Gate Tests (PR 1)
 *
 * Vynucuje, že self-evaluation je LENS nad existujícími aisha primitivy (vzor:
 * audience modul), NE nový bespoke subsystém. "Evaluation je perspektiva, ne entita."
 *
 * Spec (SoT pro tento gate):
 *   - docs/architecture/STORY_SELF_EVALUATION_LOOP.md  (§3 lens, §4 invarianty)
 *   - docs/architecture/SELF_EVAL_REUSE_VERIFICATION.md (0 nových tabulek)
 *
 * Tests-first: dokud PR 1 neimplementuje view + RPC + fix maturity, je tento gate
 * ČERVENÝ. To je záměr — gate IS the spec.
 *
 * Pravidla:
 *  1. evaluate_story_self(story_id, backend) existuje jako SoT, je read-only (STABLE),
 *     SECURITY DEFINER + REVOKE/GRANT authenticated+service_role, vrací akceschopný verdikt.
 *  2. Advisory-only: verdikt RPC NESMÍ mutovat stav (žádný INSERT/UPDATE/DELETE).
 *  3. Lens, ne reinvent: čte znovupoužité dimenze (maturity, faithfulness, drift, sentry,
 *     goal_state) — nepřepisuje je.
 *  4. Maturity fix u zdroje: get_story_aisha_maturity přestane měřit křehce
 *     (žádné agent_memories pro learning count, žádná compliance přes request_summary ILIKE).
 *  5. REUSE enforcement: migrace self-eval NESMÍ vytvořit novou tabulku (CREATE TABLE).
 *
 * @module
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = process.cwd();
const FUNCS = path.join(ROOT, "aisha/db/sql/functions");
const VIEWS = path.join(ROOT, "aisha/db/sql/views");
const DOCS = path.join(ROOT, "docs/architecture");

const EVAL_FN_PATH = path.join(FUNCS, "evaluate_story_self.sql");
const VERDICT_VIEW_PATH = path.join(VIEWS, "selfeval_story_verdict_v.sql");
const MATURITY_FN_PATH = path.join(FUNCS, "get_story_aisha_maturity.sql");

function read(p: string): string {
  return fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : "";
}

/** Strip SQL comments so DDL assertions match statements, not prose. */
function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments
    .replace(/--[^\n]*/g, " "); // line comments
}

/**
 * Canonical SoT artifacts that compose the self-eval lens (PR 1 = view + RPC +
 * maturity fix). After baseline regeneration the self-eval migration is squashed
 * into 00000000000000_baseline.sql and archived, so the SoT for "what did self-eval
 * add" is these dedicated aisha/db/sql/ files — not a per-migration script. Concat
 * them to assert the REUSE invariant (0 new tables) over current SoT.
 */
function selfEvalSotSource(): string {
  return [EVAL_FN_PATH, VERDICT_VIEW_PATH, MATURITY_FN_PATH]
    .map((p) => read(p))
    .join("\n");
}

// ---------------------------------------------------------------------------
// 1. SoT existence
// ---------------------------------------------------------------------------
describe("Self-eval lens: SoT existuje", () => {
  it("evaluate_story_self.sql existuje jako SoT", () => {
    expect(
      fs.existsSync(EVAL_FN_PATH),
      "Chybí aisha/db/sql/functions/evaluate_story_self.sql"
    ).toBe(true);
  });

  it("selfeval_story_verdict_v.sql (lens view) existuje jako SoT", () => {
    expect(
      fs.existsSync(VERDICT_VIEW_PATH),
      "Chybí aisha/db/sql/views/selfeval_story_verdict_v.sql"
    ).toBe(true);
  });

  it("REUSE_VERIFICATION doc existuje (disciplína byla provedena)", () => {
    expect(
      fs.existsSync(path.join(DOCS, "SELF_EVAL_REUSE_VERIFICATION.md")),
      "Chybí docs/architecture/SELF_EVAL_REUSE_VERIFICATION.md"
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. evaluate_story_self — kontrakt
// ---------------------------------------------------------------------------
describe("Self-eval lens: evaluate_story_self kontrakt", () => {
  it("má signaturu (p_story_id uuid, p_backend text DEFAULT NULL) a RETURNS jsonb", () => {
    const src = read(EVAL_FN_PATH);
    expect(src).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.evaluate_story_self/i);
    expect(src, "chybí p_story_id uuid").toMatch(/p_story_id\s+uuid/i);
    expect(src, "chybí p_backend (generic přes backend, PR 8 seam)").toMatch(/p_backend\s+text/i);
    expect(src, "musí RETURNS jsonb").toMatch(/RETURNS\s+jsonb/i);
  });

  it("je SECURITY DEFINER + STABLE + SET search_path (CLAUDE.md pattern)", () => {
    const src = read(EVAL_FN_PATH);
    expect(src, "musí být SECURITY DEFINER").toMatch(/SECURITY\s+DEFINER/i);
    expect(src, "musí být STABLE (read-only verdikt)").toMatch(/\bSTABLE\b/i);
    expect(src, "musí SET search_path").toMatch(/SET\s+search_path/i);
  });

  it("REVOKE ALL + GRANT authenticated + service_role (volatelné z workbench/extension/n8n)", () => {
    const src = read(EVAL_FN_PATH);
    expect(src, "musí REVOKE ALL ... FROM PUBLIC").toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.evaluate_story_self/i);
    expect(src, "musí GRANT EXECUTE TO authenticated").toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.evaluate_story_self[^;]*TO\s+authenticated/i);
    expect(src, "musí GRANT EXECUTE TO service_role").toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.evaluate_story_self[^;]*TO\s+service_role/i);
  });

  it("auth check je service_role-kompatibilní (n8n volání nesmí spadnout na auth.uid() NULL)", () => {
    const src = read(EVAL_FN_PATH);
    expect(
      /current_setting\(\s*'role'\s*,\s*true\s*\)\s*(?:=|!=)\s*'service_role'/i.test(src),
      "evaluate_story_self musí bypassovat auth/gate pro service_role (current_setting('role',true) = 'service_role'); jinak n8n/workflow volání spadne na 'not authenticated'"
    ).toBe(true);
  });

  it("vrací akceschopný verdikt (score, level, dimensions, findings, recommended_actions)", () => {
    const src = read(EVAL_FN_PATH);
    for (const key of ["story_id", "score", "level", "dimensions", "findings", "recommended_actions"]) {
      expect(src, `verdikt musí obsahovat klíč '${key}'`).toMatch(new RegExp(`'${key}'`));
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Advisory-only — verdikt NESMÍ mutovat stav
// ---------------------------------------------------------------------------
describe("Self-eval lens: advisory-only (read-only verdikt)", () => {
  it("evaluate_story_self neobsahuje INSERT/UPDATE/DELETE (verdikt nejedná sám)", () => {
    const src = read(EVAL_FN_PATH);
    // Verdikt jen čte. Akce (ai_task/proposal) jsou separátní, gated kroky (PR 4/5).
    expect(src, "verdikt RPC nesmí INSERT").not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(src, "verdikt RPC nesmí UPDATE").not.toMatch(/\bUPDATE\s+(?:public\.)?\w/i);
    expect(src, "verdikt RPC nesmí DELETE").not.toMatch(/\bDELETE\s+FROM\b/i);
  });
});

// ---------------------------------------------------------------------------
// 4. Lens, ne reinvent — čte znovupoužité dimenze
// ---------------------------------------------------------------------------
describe("Self-eval lens: reuse existujících signálů (ne paralelní subsystém)", () => {
  it("verdikt slévá znovupoužité dimenze (maturity + ≥2 z faithfulness/drift/sentry/goal)", () => {
    const combined = read(EVAL_FN_PATH) + "\n" + read(VERDICT_VIEW_PATH);
    expect(
      combined,
      "lens musí znovupoužít get_story_aisha_maturity (ne re-implementovat skóre)"
    ).toMatch(/get_story_aisha_maturity/i);

    const reuseSources = [
      /faithfulness|ai_runs/i,            // faithfulness dimenze
      /drift_state/i,                      // drift dimenze
      /sentry_issue_snapshot|correlate_sentry/i, // incidents dimenze
      /story_goal_state/i,                 // goal dimenze
    ];
    const hits = reuseSources.filter((r) => r.test(combined)).length;
    expect(
      hits,
      `lens musí číst ≥2 reuse-zdroje (faithfulness/drift/sentry/goal); nalezeno ${hits}`
    ).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// 5. Maturity fix u zdroje (fix-at-source, ne obcházet)
// ---------------------------------------------------------------------------
describe("Self-eval lens: get_story_aisha_maturity fix u zdroje", () => {
  it("learning count už nepočítá agent_memories (počítá improvement_proposals)", () => {
    const src = read(MATURITY_FN_PATH);
    expect(src, "maturity stále existuje").not.toBe("");
    expect(
      src,
      "learning count má počítat improvement_proposals, ne agent_memories"
    ).toMatch(/improvement_proposals/i);
    // Křehký agent_memories ILIKE story_id pattern musí zmizet
    expect(
      /agent_memories[\s\S]{0,200}ILIKE\s+'%'\s*\|\|\s*p_story_id/i.test(src),
      "maturity stále počítá learning z agent_memories přes ILIKE story_id (křehké)"
    ).toBe(false);
  });

  it("compliance pass rate už není měřena přes request_summary ILIKE story_id (křehké)", () => {
    const src = read(MATURITY_FN_PATH);
    expect(
      /request_summary::text\s+ILIKE\s+'%'\s*\|\|\s*p_story_id/i.test(src),
      "maturity stále koreluje compliance přes request_summary ILIKE story_id (křehké) — fix u zdroje"
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. REUSE enforcement — žádná nová tabulka
// ---------------------------------------------------------------------------
describe("Self-eval lens: 0 nových tabulek (REUSE_VERIFICATION vynucena)", () => {
  it("self-eval SoT (RPC + view + maturity fix) neobsahuje CREATE TABLE (lens, ne tabulka)", () => {
    const sot = selfEvalSotSource();
    expect(sot, "self-eval SoT artefakty ještě neexistují (PR 1 je vytvoří)").not.toBe("");
    expect(
      /CREATE\s+TABLE/i.test(stripSqlComments(sot)),
      "PR 1 nesmí přidat novou tabulku — self-eval je lens nad reuse primitivy (viz SELF_EVAL_REUSE_VERIFICATION.md)"
    ).toBe(false);
  });
});
