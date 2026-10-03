/**
 * @file heals.sql REVOKE reachability gate
 *
 * WHY THIS EXISTS — a security fix that only lands on fresh DBs is not a fix.
 *
 * On 2026-07-15, PR #733 revoked `award_tokens` (a live unlimited token mint) from
 * `authenticated` in aisha/db/sql/. CI went green, it merged, `main` was correct — and
 * production was untouched, because the generated baseline is NEVER re-applied to an
 * already-initialized DB (see aisha/db/heals.sql's header and scripts/db/migrate.mjs).
 * heals.sql is the only path to an existing DB.
 *
 * Then the heal itself was written, and it ALSO did nothing. Each SoT function file ends
 * with:
 *
 *     REVOKE ALL ON FUNCTION public.f(...) FROM PUBLIC;
 *     GRANT EXECUTE ON FUNCTION public.f(...) TO service_role;
 *
 * On a FRESH DB that is sufficient — the baseline never granted `authenticated`, so there
 * is nothing to take away. On an EXISTING DB the OLD baseline's explicit
 * `GRANT EXECUTE ... TO authenticated` is still sitting on the object, and
 * **REVOKE ... FROM PUBLIC does not touch an explicit role grant**. Copying the SoT
 * bodies into heals.sql therefore left the mint callable on exactly the databases heals
 * exists to repair. Proven by execution: a DB built from the pre-fix baseline still
 * answered has_function_privilege('authenticated','award_tokens',...) = TRUE, and the
 * exploit got past the permission check.
 *
 * THE RULE. If heals.sql revokes a function from PUBLIC, then either
 *   (a) heals.sql also GRANTs that function to `authenticated` — the grant is deliberate
 *       (e.g. WP 2.3's quota RPCs gate an end user on their own quota per JWT.sub), or
 *   (b) heals.sql also explicitly REVOKEs it FROM `authenticated`.
 * Anything else is a no-op against an existing DB: it reads as a revoke and is not one.
 *
 * Structural, not an allowlist: the rule is derived from the statements in the file, so a
 * new offender is caught the day it is written. Hard-fails — a gate that knows the answer
 * and only warns is how the award_tokens mint stayed invisible for months
 * (see security-hardened-helpers.gate.test.ts's once-commented-out assertion).
 *
 * See docs/security/IDOR_P_USER_ID_AUDIT_2026-07-15.md.
 */

import { describe, test, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();
const HEALS = join(ROOT, "aisha", "db", "heals.sql");

/** Strip line comments so a REVOKE quoted in prose is not mistaken for a statement. */
function sqlOnly(src: string): string {
  return src
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
}

function fnNames(src: string, re: RegExp): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(re)) out.add(m[1].toLowerCase());
  return out;
}

describe("heals.sql — a REVOKE must actually reach an existing DB", () => {
  const src = existsSync(HEALS) ? sqlOnly(readFileSync(HEALS, "utf-8")) : "";

  test("heals.sql exists", () => {
    expect(existsSync(HEALS)).toBe(true);
  });

  test("every REVOKE ... FROM PUBLIC either grants or explicitly revokes `authenticated`", () => {
    const revokedFromPublic = fnNames(
      src,
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+(public\.\w+)\s*\([^)]*\)\s*FROM\s+PUBLIC/gi,
    );
    const revokedFromAuthenticated = fnNames(
      src,
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+(public\.\w+)\s*\([^)]*\)\s*FROM\s+authenticated/gi,
    );
    const grantedToAuthenticated = fnNames(
      src,
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+(public\.\w+)\s*\([^)]*\)\s*TO\s+[^;]*\bauthenticated\b/gi,
    );

    const offenders = [...revokedFromPublic]
      .filter((fn) => !revokedFromAuthenticated.has(fn) && !grantedToAuthenticated.has(fn))
      .sort()
      .map(
        (fn) =>
          `${fn}: heals REVOKEs it FROM PUBLIC but never FROM authenticated, and never grants it to authenticated. ` +
          `On an existing DB the old explicit GRANT ... TO authenticated survives — this "revoke" is a no-op there. ` +
          `Add: REVOKE ALL ON FUNCTION ${fn}(<args>) FROM authenticated; (and FROM anon).`,
      );

    expect(offenders).toEqual([]);
  });

  test("a function revoked from authenticated is revoked from anon too", () => {
    const fromAuth = fnNames(
      src,
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+(public\.\w+)\s*\([^)]*\)\s*FROM\s+authenticated/gi,
    );
    const fromAnon = fnNames(
      src,
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+(public\.\w+)\s*\([^)]*\)\s*FROM\s+anon/gi,
    );
    const grantedToAnon = fnNames(
      src,
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+(public\.\w+)\s*\([^)]*\)\s*TO\s+[^;]*\banon\b/gi,
    );

    // anon is the same trap one role over: an old DB may carry an explicit anon grant.
    const offenders = [...fromAuth]
      .filter((fn) => !fromAnon.has(fn) && !grantedToAnon.has(fn))
      .sort()
      .map((fn) => `${fn}: revoked FROM authenticated but not FROM anon — an old explicit anon grant would survive.`);

    expect(offenders).toEqual([]);
  });
});
