/**
 * Gate: a deny-guard never decides on a value that can fold to SQL NULL.
 *
 * WHY (measured 2026-08-04)
 * ------------------------
 * `current_setting('request.jwt.claims', true)` returns NULL when the GUC is not
 * set. Every comparison against NULL is NULL, not false — so a NEGATIVE guard
 * built on it does not raise:
 *
 *     v_is_service := (current_setting('request.jwt.claims', true)::jsonb->>'role')
 *                     = 'service_role';        -- NULL, not false
 *     IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
 *       RAISE EXCEPTION 'Unauthorized';        -- NOT NULL = NULL -> never runs
 *     END IF;
 *
 * `IF NULL THEN` does not execute its branch, so the guard falls through and the
 * function returns its data. The check reads as strict and is fail-OPEN.
 *
 * The repo already knew this — `is_service_role.sql` was written for exactly this
 * reason (#588) and COALESCEs to false, making the guard total. What never
 * happened was the migration: on the day this gate was written, 4 functions used
 * the canonical reader and **73 still carried the folding idiom** — 14 comparing
 * inline, 59 through a variable. The variable form is the dangerous one, because
 * the negative guard does not mention `request.jwt.claims` at all and no grep for
 * the claims string finds it.
 *
 * WHAT THIS GATE DELIBERATELY DOES NOT CHECK
 * ------------------------------------------
 * - POSITIVE use: `IF is_admin OR claims->>'role' = 'service_role' THEN <allow>`
 *   folds to NULL as well, but NULL is not true, so the allow branch does NOT
 *   run. That direction fails CLOSED and is safe; flagging it would be noise.
 * - RLS policies and views. `USING` clauses treat NULL as "row not visible", so
 *   the same fold is closed there. Ownership stays with the policy gates.
 * - Whether a guard is *correct* — only whether it can fold. A guard that checks
 *   the wrong role is this gate's blind spot on purpose; one property, one owner.
 *
 * No name is ever exempted. The canonical readers pass because they COALESCE,
 * which is the property being asked for — not because they are on a list.
 *
 * To fix a failure: read the role through `public.is_service_role()` (or
 * `public.get_jwt_role()`), which are boolean/text NOT NULL, instead of comparing
 * the raw claim.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(__dirname, "../../..");
const FN_DIR = resolve(ROOT, "aisha/db/sql/functions");

/** Universe: every SoT function file, DISCOVERED from the tree. */
function functionFiles(): string[] {
  return readdirSync(FN_DIR).filter((f) => f.endsWith(".sql"));
}

/** SQL comments are prose about the idiom — reading them would flag the docs. */
function code(file: string): string {
  return readFileSync(join(FN_DIR, file), "utf-8")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
}

const CLAIMS = /current_setting\(\s*'request\.jwt\.claims'/;
/** A read that is already made total — by COALESCE or by a canonical reader. */
const MADE_TOTAL = /coalesce|is_service_role\(\)|get_jwt_role\(\)/i;

describe("deny guards cannot fold to NULL", () => {
  it("the universe is seeded from reality and is not empty", () => {
    // A gate over zero functions passes vacuously — worse than no gate at all.
    expect(functionFiles().length).toBeGreaterThan(200);
    expect(functionFiles().filter((f) => CLAIMS.test(code(f))).length).toBeGreaterThan(20);
  });

  it("no negative guard compares the raw claim inline", () => {
    const violations: string[] = [];
    for (const file of functionFiles()) {
      const src = code(file);
      if (!CLAIMS.test(src)) continue;
      if (MADE_TOTAL.test(src)) continue;
      // `IF NOT … claims …` / `NOT ( … claims … )`
      if (
        /IF\s+NOT[^;]{0,400}?current_setting\(\s*'request\.jwt\.claims'/is.test(src) ||
        /NOT\s*\([^;]{0,300}?current_setting\(\s*'request\.jwt\.claims'/is.test(src)
      ) {
        violations.push(file);
      }
    }
    expect(
      violations,
      "A comparison against an unset claim is NULL, so `IF NOT <it> THEN RAISE` " +
        "never raises and the guard admits the caller. Read the role through " +
        "public.is_service_role() instead:\n  " +
        violations.join("\n  "),
    ).toEqual([]);
  });

  it("no negative guard decides on a variable assigned from the raw claim", () => {
    // The dangerous shape: the guard itself never mentions the claim, so it is
    // invisible to any search for `request.jwt.claims` near a NOT.
    const assign =
      /(\w+)\s*:=\s*([^;]*?current_setting\(\s*'request\.jwt\.claims'[^;]*?);/gis;
    const violations: string[] = [];

    for (const file of functionFiles()) {
      const src = code(file);
      if (!CLAIMS.test(src)) continue;
      for (const m of src.matchAll(assign)) {
        const [, variable, rhs] = m;
        if (MADE_TOTAL.test(rhs)) continue;
        if (new RegExp(`NOT\\s+${variable}\\b`, "i").test(src)) {
          violations.push(`${file} (${variable})`);
          break;
        }
      }
    }
    expect(
      violations,
      "These assign a possibly-NULL comparison to a variable and then negate it. " +
        "`NOT NULL` is NULL, so the deny branch never runs — the guard reads as " +
        "strict and is fail-OPEN:\n  " +
        violations.join("\n  "),
    ).toEqual([]);
  });
});
