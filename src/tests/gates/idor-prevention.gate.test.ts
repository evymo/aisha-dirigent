/**
 * IDOR Prevention Gate Test
 *
 * Static analysis to verify that SECURITY DEFINER functions
 * properly validate ownership via auth.uid() to prevent
 * Insecure Direct Object Reference attacks.
 *
 * CRITICAL: SECURITY DEFINER functions bypass RLS, so they MUST
 * manually verify the caller's identity. Without this check,
 * any authenticated user could access any other user's data by
 * guessing IDs.
 *
 * Categories:
 * 1. get_my_* functions — must use auth.uid() in WHERE clause
 * 2. update_my_* / delete_my_* — must use auth.uid() in WHERE clause
 * 3. Admin functions — must check is_admin_or_staff()
 * 4. Partner functions — must verify consent
 * 5. Functions accepting p_user_id — must validate against auth.uid()
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { stripSqlComments } from '../../../scripts/db/lib/sql-comments.mjs';

const PROJECT_ROOT = process.cwd();
const SQL_FUNCTIONS_DIR = join(PROJECT_ROOT, 'aisha/db/sql/functions');

function readSafe(path: string): string {
  // Rozhoduje KÓD, ne komentáře — jeden domov pravidla (sql-comments.mjs).
  try { return stripSqlComments(readFileSync(path, 'utf-8')); } catch { return ''; }
}


interface Violation {
  file: string;
  detail: string;
  fix: string;
}

function formatViolations(violations: Violation[]): string {
  return violations
    .map(v => `  ${v.file} — ${v.detail}\n    ✏️  FIX: ${v.fix}`)
    .join('\n');
}

/** Files with known exceptions and reasons. */
const IDOR_ALLOWLIST: Record<string, string> = {
  // Utility functions that don't access user data
  'get_my_app_version.sql': 'returns app config, not user data',
  'get_my_feature_flags.sql': 'returns global feature flags, no user data',
};

// ═══════════════════════════════════════════════════════════════════════════════

describe('IDOR Prevention — auth.uid() Ownership Verification', () => {
  const allSqlFiles = existsSync(SQL_FUNCTIONS_DIR)
    ? readdirSync(SQL_FUNCTIONS_DIR).filter(f => f.endsWith('.sql'))
    : [];

  it('scans significant number of SQL functions', () => {
    expect(allSqlFiles.length).toBeGreaterThan(100);
  });

  // ─── 1. get_my_* functions ───────────────────────────────────────────────

  it('get_my_* SECURITY DEFINER functions use auth.uid()', () => {
    const violations: Violation[] = [];
    // Match both the bare `get_my_*` convention AND module-prefixed self-scoped
    // RPCs like `audience_get_my_tier` / `audience_get_my_audience` (the member's
    // own-data path). The bare-prefix-only filter let the audience get_my_* RPCs
    // escape the auth.uid() ownership check — dropping their `WHERE user_id =
    // auth.uid()` would have passed the static gate (coverage-audit finding).
    const myGetFunctions = allSqlFiles.filter(f => f.startsWith('get_my_') || f.includes('_get_my_'));

    for (const file of myGetFunctions) {
      if (IDOR_ALLOWLIST[file]) continue;
      const content = readSafe(join(SQL_FUNCTIONS_DIR, file));

      if (/SECURITY DEFINER/i.test(content)) {
        const hasAuthUid = /auth\.uid\(\)/i.test(content);
        if (!hasAuthUid) {
          violations.push({
            file,
            detail: 'SECURITY DEFINER get_my_* without auth.uid() — any user can read any user\'s data',
            fix: 'Add WHERE user_id = auth.uid() to the query, or change to SECURITY INVOKER if RLS handles it',
          });
        }
      }
    }

    expect(
      violations,
      `IDOR: get_my_* functions without ownership check (${violations.length}):\n${formatViolations(violations)}`
    ).toEqual([]);
  });

  // ─── 2. update_my_* / delete_my_* functions ─────────────────────────────

  it('update_my_* SECURITY DEFINER functions use auth.uid()', () => {
    const violations: Violation[] = [];
    const myMutationFunctions = allSqlFiles.filter(f =>
      f.startsWith('update_my_') || f.startsWith('delete_my_') || f.startsWith('upsert_my_')
    );

    for (const file of myMutationFunctions) {
      if (IDOR_ALLOWLIST[file]) continue;
      const content = readSafe(join(SQL_FUNCTIONS_DIR, file));

      if (/SECURITY DEFINER/i.test(content)) {
        const hasAuthUid = /auth\.uid\(\)/i.test(content);
        if (!hasAuthUid) {
          violations.push({
            file,
            detail: 'SECURITY DEFINER mutation without auth.uid() — any user can modify any user\'s data',
            fix: 'Add WHERE user_id = auth.uid() to UPDATE/DELETE, or validate auth.uid() at function start',
          });
        }
      }
    }

    expect(
      violations,
      `IDOR: mutation functions without ownership check (${violations.length}):\n${formatViolations(violations)}`
    ).toEqual([]);
  });

  // ─── 3. p_user_id parameter validation ───────────────────────────────────

  it('user-reachable functions accepting a caller-controlled p_user_id validate it (IDOR)', () => {
    const violations: Violation[] = [];

    // NO name allowlist — "výjimka je diagnostika". A function is safe iff its OWN
    // body proves it (a self/admin/service guard, or a consent/relationship gate);
    // the checks below DERIVE that from the source. If a by-design cross-user
    // function reaches here, it is missing the very guard that makes it by-design.

    for (const file of allSqlFiles) {
      const content = readSafe(join(SQL_FUNCTIONS_DIR, file));
      if (!/SECURITY DEFINER/i.test(content)) continue;

      // p_user_id must be a SIGNATURE parameter (caller-controlled), not merely an
      // internal variable. `v_user_id := auth.uid(); ... helper(p_user_id => v_user_id)`
      // is a false positive — the caller does not control it.
      const sig = (content.match(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION[^(]*\(([\s\S]*?)\)\s*RETURNS/i) || [])[1] || '';
      if (!/\bp_user_id\b/i.test(sig)) continue;

      // Only PostgREST-reachable functions are a direct IDOR: those GRANTed to the
      // authenticated role. Backend-only (service_role / definer / trigger) callers
      // set p_user_id from a trusted context, so a revoke of the authenticated grant
      // IS the fix and drops the function off this list.
      if (!/GRANT\s+EXECUTE[^;]*\bTO\b[^;]*\bauthenticated\b/i.test(content)) continue;

      // Boolean predicates leak at most one bit ("can user X chat") — out of scope
      // for this data-access gate; and triggers set the id from NEW.*.
      if (/^(is_|has_|check_|can_|trigger_)/.test(file) || /RETURNS\s+(TRIGGER|boolean)\b/i.test(content)) continue;

      // Guarded = the caller cannot substitute another user's id. Recognise every
      // shape the fixed functions use, including comparison via a local that holds
      // auth.uid() and the auth-first COALESCE / role-gated (service_role) patterns.
      const cmp = String.raw`(?:=|<>|!=|IS\s+DISTINCT\s+FROM)`;
      const capturesAuthUid = /\b\w+\s*(?::=|uuid\s*:=)\s*auth\.uid\(\)/i.test(content);
      const comparesPUserId = new RegExp(String.raw`\bp_user_id\b\s*${cmp}|${cmp}\s*\bp_user_id\b`, 'i').test(content);
      const guarded =
        new RegExp(String.raw`p_user_id\s*${cmp}\s*auth\.uid\(\)`, 'i').test(content) ||
        new RegExp(String.raw`auth\.uid\(\)\s*${cmp}\s*p_user_id`, 'i').test(content) ||
        /is_admin_or_staff|is_service_role|has_role|user_has_admin_role|v_is_service\b/i.test(content) ||
        /(?:=\s*|current_setting\([^)]*\)\s*=\s*)['"]service_role['"]/i.test(content) ||
        /COALESCE\s*\(\s*auth\.uid\(\)/i.test(content) ||
        /p_user_id\s+uuid\s*(?:DEFAULT|=)\s*auth\.uid\(\)/i.test(sig) ||
        // auth.uid() captured to a local var that is then compared to p_user_id
        (capturesAuthUid && comparesPUserId) ||
        // Consent / assignment relationship gate — a partner/consultant may act on
        // p_user_id only through an explicit consent or assignment record.
        /has_data_sharing_consent|data_sharing_consent|assigned_partner_id|is_consultant_for_user/i.test(content) ||
        // Raises an AUTHORIZATION exception (beyond mere 'Not authenticated') — the
        // body gates access to the subject via a self/role/consent/permission check
        // (e.g. can_invite_to_study(), audience_user_can_see_creator_stats()).
        /RAISE\s+EXCEPTION[^;]*(?:Access denied|Unauthoriz|Forbidden|not authoriz|permission denied)/i.test(content) ||
        /ERRCODE\s*=\s*['"]42501['"]/i.test(content);

      if (!guarded) {
        violations.push({
          file,
          detail: 'SECURITY DEFINER granted to authenticated accepts a caller-controlled p_user_id with no auth.uid()/admin/service guard — any logged-in user can act on another user by passing their id (IDOR)',
          fix: 'Guard at the top — IF p_user_id <> auth.uid() AND NOT is_service_role() AND NOT is_admin_or_staff() THEN RAISE EXCEPTION \'Forbidden\' USING ERRCODE=\'42501\'; END IF; — or REVOKE EXECUTE FROM authenticated (backend-only), or add to P_USER_ID_BY_DESIGN with a consent reason.',
        });
      }
    }

    expect(
      violations,
      `IDOR: user-reachable p_user_id without ownership guard (${violations.length}):\n${formatViolations(violations)}`
    ).toEqual([]);
  });

  // ─── 4. Admin functions ──────────────────────────────────────────────────

  it('admin_* SECURITY DEFINER functions check is_admin_or_staff()', () => {
    const violations: Violation[] = [];

    // ⛔ ORÁKULUM NENÍ AKCE SPRÁVCE. Tyhle funkce na otázku „je to admin?" ODPOVÍDAJÍ;
    // požadovat po nich `is_admin_or_staff` je kruh (stráž by volala sebe sama).
    // Že orákulum odpoví i na CIZÍ id, je vlastnost, kterou majitel rozhodl u `has_role` —
    // ne nález téhle brány.
    const IDOR_ADMIN_ALLOWLIST = new Set([
      'bootstrap_default_admin.sql',
      'role_is_admin.sql',
      // 2026-09-16: vyplavalo, až když detektor přestal číst komentáře jako kód —
      // dosud procházel jen proto, že se regex na stráž trefil do jeho PROSY.
      'is_user_admin.sql',
    ]);

    const adminFunctions = allSqlFiles.filter(f =>
      f.startsWith('admin_') || f.endsWith('_admin.sql') ||
      f.includes('_all_users') || f.includes('_all_members')
    );

    for (const file of adminFunctions) {
      if (IDOR_ADMIN_ALLOWLIST.has(file)) continue;

      const content = readSafe(join(SQL_FUNCTIONS_DIR, file));

      // Only check SECURITY DEFINER functions — SECURITY INVOKER relies on RLS
      if (!/SECURITY DEFINER/i.test(content)) continue;

      const hasAdminCheck =
        /is_admin_or_staff/i.test(content) ||
        /has_role\s*\(/i.test(content) ||
        /user_has_admin_role/i.test(content) ||
        /user_roles.*role\s+IN.*admin/is.test(content) ||
        /RAISE\s+EXCEPTION.*access/i.test(content) ||
        /RAISE\s+EXCEPTION.*permission/i.test(content) ||
        /RAISE\s+EXCEPTION.*unauthorized/i.test(content) ||
        /RAISE\s+EXCEPTION.*admin/i.test(content) ||
        /RETURN.*error/i.test(content); // for RETURN jsonb_build_object('success', false, 'error', '...')

      if (!hasAdminCheck) {
        violations.push({
          file,
          detail: 'admin function with SECURITY DEFINER but no admin authorization check',
          fix: 'Add: IF NOT is_admin_or_staff() THEN RAISE EXCEPTION \'Admin access required\'; END IF;',
        });
      }
    }

    expect(
      violations,
      `Admin SECURITY DEFINER functions without authorization (${violations.length}):\n${formatViolations(violations)}`
    ).toEqual([]);
  });

  // ─── 5. Partner consent functions ────────────────────────────────────────

  it('partner data access functions verify consent', () => {
    const violations: Violation[] = [];

    // Only functions where partner accesses USER data, not partner's own data
    const partnerFunctions = allSqlFiles.filter(f => {
      const name = f.toLowerCase();
      return (
        /partner/.test(name) &&
        /(?:user|health|check_in|lab|dosing|member|patient)/.test(name) &&
        !f.startsWith('get_public_') &&
        // Exclude partner's own data management
        !name.includes('availability') &&
        !name.includes('available_slots') &&
        !name.includes('partner_profile') &&
        !name.includes('partner_setting') &&
        // Exclude platform admin operations
        !name.includes('claim_user') &&
        !name.includes('unclaimed_users') &&
        !name.includes('permissions') &&
        !name.includes('app_permissions')
      );
    });

    for (const file of partnerFunctions) {
      const content = readSafe(join(SQL_FUNCTIONS_DIR, file));

      const hasConsentCheck =
        /data_sharing_consent/i.test(content) ||
        /has_data_sharing_consent/i.test(content) ||
        /consent/i.test(content);

      const isAdminOnly = /is_admin_or_staff/i.test(content) && !/practitioner/i.test(content);

      if (!hasConsentCheck && !isAdminOnly) {
        violations.push({
          file,
          detail: 'partner function accessing user data without consent verification',
          fix: 'Add JOIN data_sharing_consents or call has_data_sharing_consent() before returning data',
        });
      }
    }

    expect(
      violations,
      `Partner functions without consent check (${violations.length}):\n${formatViolations(violations)}`
    ).toEqual([]);
  });
});
