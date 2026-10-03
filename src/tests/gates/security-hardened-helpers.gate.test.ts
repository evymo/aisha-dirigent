/**
 * Security Gate: Hardened SECURITY DEFINER Helper Functions
 *
 * Enforces the auth-first COALESCE pattern across all PostgreSQL
 * SECURITY DEFINER functions that accept a p_user_id parameter.
 *
 * The invariant: auth.uid() (JWT identity) MUST take priority over
 * explicit p_user_id in COALESCE expressions. This prevents
 * authenticated users from probing other users' data via direct
 * PostgREST RPC calls, while preserving service_role compatibility
 * (auth.uid() IS NULL → falls back to p_user_id).
 *
 * Correct:   COALESCE(auth.uid(), p_user_id)    — JWT wins
 * Incorrect: COALESCE(p_user_id, auth.uid())    — parameter wins (probe surface)
 * Incorrect: user_id = p_user_id                — no COALESCE at all
 */

import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const PROJECT_ROOT = process.cwd();
const SQL_FUNCTIONS_DIR = join(PROJECT_ROOT, 'aisha/db/sql/functions');

/** Read a SQL file and return its content, or null if missing. */
function readSql(filename: string): string | null {
  const path = join(SQL_FUNCTIONS_DIR, filename);
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf-8');
}

/** Check if a SQL file declares a p_user_id uuid parameter. */
function hasUserIdParam(content: string): boolean {
  return /\bp_user_id\s+uuid\b/i.test(content);
}

// ── Intranet scope (Phase 1) ─────────────────────────────────────────────

describe('Security: auth-first COALESCE — intranet functions', () => {
  test('is_intranet_channel_member uses COALESCE(auth.uid(), p_user_id)', () => {
    const sql = readSql('is_intranet_channel_member.sql');
    expect(sql).not.toBeNull();
    expect(sql!).toMatch(/COALESCE\s*\(\s*auth\.uid\(\)\s*,\s*p_user_id\s*\)/i);
  });

  test('is_intranet_channel_member does NOT use parameter-first COALESCE', () => {
    const sql = readSql('is_intranet_channel_member.sql');
    expect(sql).not.toBeNull();
    expect(sql!).not.toMatch(/COALESCE\s*\(\s*p_user_id\s*,\s*auth\.uid\(\)\s*\)/i);
  });

  test('is_intranet_channel_member does NOT use direct user_id = p_user_id', () => {
    const sql = readSql('is_intranet_channel_member.sql');
    expect(sql).not.toBeNull();
    // Match "user_id = p_user_id" but NOT inside a COALESCE wrapper
    const bodyMatch = sql!.match(/\$\$[\s\S]*\$\$/);
    if (bodyMatch) {
      const body = bodyMatch[0];
      // Remove COALESCE expressions, then check for bare p_user_id assignment
      const withoutCoalesce = body.replace(/COALESCE\s*\([^)]+\)/gi, 'COALESCE_REMOVED');
      expect(withoutCoalesce).not.toMatch(/user_id\s*=\s*p_user_id/i);
    }
  });

  test('join_intranet_channel uses COALESCE(auth.uid(), p_user_id)', () => {
    const sql = readSql('join_intranet_channel.sql');
    expect(sql).not.toBeNull();
    expect(sql!).toMatch(/COALESCE\s*\(\s*auth\.uid\(\)\s*,\s*p_user_id\s*\)/i);
  });

  test('join_intranet_channel does NOT use parameter-first COALESCE', () => {
    const sql = readSql('join_intranet_channel.sql');
    expect(sql).not.toBeNull();
    expect(sql!).not.toMatch(/COALESCE\s*\(\s*p_user_id\s*,\s*auth\.uid\(\)\s*\)/i);
  });

  test('join_intranet_channel has no redundant impersonation guard', () => {
    const sql = readSql('join_intranet_channel.sql');
    expect(sql).not.toBeNull();
    // With auth-first COALESCE, explicit p_user_id != auth.uid() guards are unnecessary
    expect(sql!).not.toMatch(/p_user_id\s*!=\s*auth\.uid\(\)/i);
    expect(sql!).not.toMatch(/cannot_join_as_another_user/i);
  });
});

// ── Platform-wide invariants (catches future violations) ──────────────────

describe('Security: auth-first COALESCE — platform invariants', () => {

  // Functions that are KNOWN to still have parameter-first COALESCE.
  // These are Phase 2 scope — each will be fixed in a follow-up PR.
  // Once fixed, remove from this set and the test will enforce auth-first.
  const KNOWN_PARAM_FIRST_FUNCTIONS = new Set([
    'is_admin_or_staff',
    'write_audit_journal',
    'get_user_app_permissions',
    'check_user_has_password',
    'get_chat_access_level',
    'get_partner_type',
    'create_token_transaction',
    'get_longevity_score_history_audited',
    'is_certified_partner',
  ]);

  test('no NEW functions with parameter-first COALESCE(p_user_id, auth.uid())', () => {
    if (!existsSync(SQL_FUNCTIONS_DIR)) return;
    const files = readdirSync(SQL_FUNCTIONS_DIR).filter(f => f.endsWith('.sql'));
    const violations: string[] = [];

    for (const file of files) {
      const fnName = file.replace('.sql', '');
      if (KNOWN_PARAM_FIRST_FUNCTIONS.has(fnName)) continue;

      const content = readFileSync(join(SQL_FUNCTIONS_DIR, file), 'utf-8');
      if (!hasUserIdParam(content)) continue;

      // Check for parameter-first COALESCE
      if (/COALESCE\s*\(\s*p_user_id\s*,\s*auth\.uid\(\)\s*\)/i.test(content)) {
        violations.push(`${fnName}: uses COALESCE(p_user_id, auth.uid()) — must swap to COALESCE(auth.uid(), p_user_id)`);
      }
    }

    expect(violations, `New functions with vulnerable COALESCE order:\n${violations.join('\n')}`).toHaveLength(0);
  });

  test('has_role anon grant is tracked as Phase 2 fix', () => {
    const sql = readSql('has_role.sql');
    if (!sql) return; // File may not exist in worktree
    const grantLines = sql.split('\n').filter(l => /GRANT\s+EXECUTE/i.test(l));
    const hasAnonGrant = grantLines.some(l => /\banon\b/i.test(l));
    // Phase 2 will revoke anon grant from has_role. Until then, track it:
    if (hasAnonGrant) {
      console.warn('[Phase 2 TODO] has_role grants to anon — information disclosure risk');
    }
    // Flip this to `expect(hasAnonGrant).toBe(false)` when Phase 2 lands:
    expect(hasAnonGrant).toBe(true); // Known pre-existing issue
  });

  // Functions that are internal-only and must NOT have GRANT TO authenticated/anon
  const MUST_BE_INTERNAL_ONLY = [
    'create_notification',
    'add_system_timeline_entry',
  ];

  test('internal-only functions have no authenticated/anon grant', () => {
    const violations: string[] = [];
    for (const fn of MUST_BE_INTERNAL_ONLY) {
      const sql = readSql(`${fn}.sql`);
      if (!sql) continue;
      const grantLines = sql.split('\n').filter(l => /GRANT\s+EXECUTE/i.test(l));
      for (const line of grantLines) {
        if (/\b(authenticated|anon)\b/i.test(line)) {
          violations.push(`${fn}: internal function grants to authenticated/anon`);
        }
      }
    }
    // Enabled 2026-07-15. This assertion sat commented out behind a "Phase 2" that never landed,
    // so for months the gate computed these violations correctly and then reported a LIVE
    // vulnerability as a console.warn nobody reads — create_notification let any logged-in user
    // plant an arbitrary link in any user's notification feed, and add_system_timeline_entry let
    // them forge 'system_' entries in any user's medical timeline. A gate that knows the answer
    // and does not fail is worse than no gate: it makes the build look clean.
    // See docs/security/IDOR_P_USER_ID_AUDIT_2026-07-15.md.
    expect(violations).toEqual([]);
  });
});

// ── Direct p_user_id probe surface detection ──────────────────────────────

describe('Security: no direct p_user_id probe surface in intranet functions', () => {

  // Intranet-scoped functions that accept p_user_id and are SECURITY DEFINER
  const INTRANET_FUNCTIONS_WITH_USER_ID = [
    'is_intranet_channel_member',
    'join_intranet_channel',
  ];

  for (const fnName of INTRANET_FUNCTIONS_WITH_USER_ID) {
    test(`${fnName}: p_user_id is wrapped in auth-first COALESCE`, () => {
      const sql = readSql(`${fnName}.sql`);
      expect(sql).not.toBeNull();

      // Extract function body (between $$ ... $$)
      const bodyMatch = sql!.match(/\$\$[\s\S]*?\$\$/);
      expect(bodyMatch).not.toBeNull();
      const body = bodyMatch![0];

      // Positive: must contain auth-first COALESCE
      expect(body).toMatch(/COALESCE\s*\(\s*auth\.uid\(\)\s*,\s*p_user_id\s*\)/i);

      // Negative: must NOT contain bare "= p_user_id" without COALESCE
      const withoutCoalesce = body.replace(/COALESCE\s*\([^)]+\)/gi, '__COALESCE__');
      expect(withoutCoalesce).not.toMatch(/=\s*p_user_id\b/i);
    });
  }
});

// ── KNOWN_PARAM_FIRST tracking (ensures the list shrinks over time) ───────

describe('Security: Phase 2 tracking', () => {
  test('KNOWN_PARAM_FIRST_FUNCTIONS count is documented (9 remaining)', () => {
    // When you fix a function in Phase 2, remove it from the set above
    // and update this count. The gate fails if the count drifts.
    const KNOWN_PARAM_FIRST_FUNCTIONS = new Set([
      'is_admin_or_staff',
      'write_audit_journal',
      'get_user_app_permissions',
      'check_user_has_password',
      'get_chat_access_level',
      'get_partner_type',
      'create_token_transaction',
      'get_longevity_score_history_audited',
      'is_certified_partner',
    ]);
    // 2026-09-19: is_user_admin, is_professional_partner a can_access_admin_section
    // přešly na auth-first (predikát o třetí osobě = orákulum) — 12 → 9.
    expect(KNOWN_PARAM_FIRST_FUNCTIONS.size).toBe(9);
  });
});
