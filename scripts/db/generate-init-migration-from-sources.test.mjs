import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import {
  maskSqlForLint,
  collectFunctionLintIssues,
  statementEndIndex,
  extractPolicyStatements,
} from "./generate-init-migration-from-sources.mjs";

// ---------------------------------------------------------------------------
// maskSqlForLint — comment / string masking, dollar-body preservation
// ---------------------------------------------------------------------------

describe("maskSqlForLint", () => {
  it("blanks `-- line comment` content but keeps the newline and following SQL", () => {
    const input = "-- call public.foo(a, b)\nSELECT 1;";
    const masked = maskSqlForLint(input);

    expect(masked).toHaveLength(input.length); // offsets stay valid for slice()
    expect(masked).toContain("\n"); // newline preserved
    expect(masked).not.toContain("public.foo"); // comment body gone
    expect(masked).toContain("SELECT 1;"); // real SQL untouched
  });

  it("blanks `/* block comment */` content (multi-line) but keeps newlines", () => {
    const input = "/* public.foo(a)\n   public.bar(b) */\nSELECT 2;";
    const masked = maskSqlForLint(input);

    expect(masked).toHaveLength(input.length);
    expect(masked).not.toContain("public.foo");
    expect(masked).not.toContain("public.bar");
    expect(masked).toContain("SELECT 2;");
  });

  it("blanks single-quoted string bodies (incl. '' escapes) but keeps the quotes", () => {
    const input = "SELECT 'it''s public.foo(x)' AS msg;";
    const masked = maskSqlForLint(input);

    expect(masked).toHaveLength(input.length);
    expect(masked).not.toContain("public.foo");
    // delimiting quotes are preserved so paren/arg scanning stays balanced
    expect(masked).toContain("'");
    // statement structure after the string is intact
    expect(masked).toContain("AS msg;");
  });

  it("preserves dollar-quoted bodies so genuine calls inside them remain visible", () => {
    const input = "AS $$ BEGIN PERFORM public.bar(x); END $$;";
    const masked = maskSqlForLint(input);

    expect(masked).toContain("public.bar(x)"); // real call must survive masking
  });

  it("does not treat `--` inside a string as a comment", () => {
    const input = "SELECT 'a -- b' || public.real_call(x);";
    const masked = maskSqlForLint(input);

    // the `--` lives inside the string, so the trailing real call must survive
    expect(masked).toContain("public.real_call(x)");
  });
});

// ---------------------------------------------------------------------------
// collectFunctionLintIssues — regression: documented signatures lint clean,
// genuine wrong-arity calls still fail.
// ---------------------------------------------------------------------------

// A function whose HEADER COMMENT mentions `public.<name> (prose)`. Before the
// comment-stripping fix this was parsed as a 1-arg CALL and tripped
// `call-missing-overload`. It must now lint clean.
const DOCUMENTED_FN_SQL = `-- Function: public.record_model_reliability  (L1 — REPLACE writer for ai_model_reliability)
-- service_role only. Returns the row id.
CREATE OR REPLACE FUNCTION public.record_model_reliability(
  p_model_registry_id uuid,
  p_task_kind         text,
  p_sample_count      bigint DEFAULT 0
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RAISE EXCEPTION 'must not call public.record_model_reliability() with no rows';
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.record_model_reliability(uuid, text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_model_reliability(uuid, text, bigint) TO service_role;
`;

// A function whose BODY makes a genuine wrong-arity call to the function above
// (1 arg, but the overload requires at least 2). This is a true positive and
// must continue to fail.
const WRONG_ARITY_CALLER_SQL = `-- Function: public.caller_fn  (calls record_model_reliability incorrectly)
CREATE OR REPLACE FUNCTION public.caller_fn(p_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- intentionally too few args: record_model_reliability needs >= 2
  PERFORM public.record_model_reliability(p_id);
END $$;

GRANT EXECUTE ON FUNCTION public.caller_fn(uuid) TO service_role;
`;

describe("collectFunctionLintIssues", () => {
  let dir;
  const write = (name, sql) => {
    const p = path.join(dir, name);
    writeFileSync(p, sql, "utf-8");
    return p;
  };

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "aisha-lint-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("lints clean when `public.<fn> (prose)` appears only in a header comment / string body", () => {
    const fn = write("record_model_reliability.sql", DOCUMENTED_FN_SQL);
    const issues = collectFunctionLintIssues([fn]);
    expect(issues).toEqual([]);
  });

  it("still flags a genuine call with the wrong argument count", () => {
    const a = write("record_model_reliability.sql", DOCUMENTED_FN_SQL);
    const b = write("caller_fn.sql", WRONG_ARITY_CALLER_SQL);

    const issues = collectFunctionLintIssues([a, b]);
    const callIssues = issues.filter((i) => i.type === "call-missing-overload");

    expect(callIssues).toHaveLength(1);
    expect(callIssues[0].message).toContain(
      "public.record_model_reliability(1 args)"
    );
    // The offending reference is the body call in caller_fn.sql — NOT the
    // documented header comment in record_model_reliability.sql.
    expect(callIssues[0].file).toContain("caller_fn.sql");
  });
});

// ---------------------------------------------------------------------------
// statementEndIndex / extractPolicyStatements — středník v komentáři neuřezává
// ---------------------------------------------------------------------------

describe("konec příkazu se hledá v KÓDU, ne v komentáři", () => {
  // Doslovný tvar, na kterém to prasklo (li_source_registry_read.sql, #259).
  const POLICY = [
    "CREATE POLICY li_read ON public.li_source_registry",
    "  FOR SELECT TO authenticated",
    "  USING (",
    "    (SELECT public.is_admin_or_staff())",
    "    -- Materiál a množství jsou přitom na dokladu; řidič je proto neviděl.",
    "    OR doc_slug IN (SELECT s.doc_slug FROM public.steps s)",
    "  );",
  ].join("\n");

  it("policy se středníkem v komentáři zůstane CELÁ", () => {
    // ⛔ Regex `/CREATE\s+POLICY[\s\S]*?;/` tu vracel jen prvních pět řádků:
    //    `USING (` se nezavřelo a všechno další se v baseline vsáklo do
    //    nedokončené věty. psql pak spadl až na konci souboru hláškou
    //    `syntax error at or near "DROP"` — u cizího příkazu, 9 000 řádků od
    //    příčiny. SoT byl přitom bezvadný.
    const [{ statement }] = extractPolicyStatements(POLICY);
    expect(statement).toContain("řidič je proto neviděl");
    expect(statement).toContain("OR doc_slug IN");
    expect(statement.trimEnd().endsWith(");")).toBe(true);
  });

  it("středník v řetězci ani v dolarovém bloku příkaz nekončí", () => {
    const sql = "CREATE POLICY p ON t USING (x = 'a;b' AND y = $q$c;d$q$);";
    // Konvence `main`: vrací pozici ZA středníkem (volající tím rovnou krájí),
    // zatímco původní verze v téhle větvi vracela index středníku. Vlastnost je
    // TÁŽ — středník v řetězci ani v dolarovém bloku příkaz nekončí; liší se jen
    // o jedničku. Měříme vlastnost, ne konvenci.
    expect(statementEndIndex(sql, 0)).toBe(sql.length);
  });

  it("neukončený příkaz se hlásí jako -1, neuřezává se", () => {
    // Vada VSTUPU není důvod vydat půlku příkazu za celý.
    expect(statementEndIndex("CREATE POLICY p ON t USING (x)", 0)).toBe(-1);
  });
});
