/**
 * Static defense write-side RPC integrity gate (Phase 7)
 *
 * Phase 6 added the READ side: aisha_get_active_static_defense_rules() RPC
 * that lets the generator pull active rules. But without write-side RPCs,
 * Aisha (autonomous) and operators (Appsmith UI) couldn't add new rules
 * without direct table INSERTs — bypassing audit trail + status lifecycle
 * + validation.
 *
 * Phase 7 fills that gap with three RPCs:
 *   - aisha_propose_static_defense_rule  → INSERT/UPDATE draft
 *   - aisha_publish_static_defense_rule  → UPDATE draft → active (admin only)
 *   - aisha_deprecate_static_defense_rule → UPDATE active → deprecated (admin only)
 *
 * This gate enforces:
 *   1. All three SoT files exist with canonical SECURITY DEFINER pattern
 *   2. The bundling migration exists and contains all three function defs
 *   3. Each RPC validates inputs (rule_id kebab-case, enums)
 *   4. Publish + deprecate are admin-only (via is_user_admin check)
 *   5. Every write action logs to audit_journal
 *
 * Why static (not runtime): CI doesn't have a live DB. Verifying RPC SQL
 * source ensures the contract stays intact between PRs — anyone removing
 * an audit_journal INSERT or downgrading the auth check fails the gate.
 */

import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const FUNCTIONS_DIR = resolve(ROOT, 'aisha/db/sql/functions');

/**
 * „Tahle funkce má service_role bypass" — VLASTNOST, ne pravopis.
 *
 * Dřív se to poznávalo regexem `/role'.+'service_role'/`, tedy podle doslovného
 * inline porovnání claimu. Ten idiom se ale skládá na SQL NULL a dělá z
 * deny-guardu fail-open (změřeno 2026-08-04 na 73 funkcích), takže ho brána
 * deny-guard-null-fold dnes zakazuje a repo přešlo na kanonickou čtečku.
 *
 * Kdyby se dopsala jen pozitivní větev, negativní kontrola níž („admin-only RPC
 * NESMÍ mít bypass") by od té chvíle procházela FALEŠNĚ: hledala by pravopis,
 * který už nikde není, a bypass zapsaný kanonicky by přehlédla. Proto oba směry
 * sdílejí tenhle jeden vzor.
 */
const SERVICE_BYPASS =
  /is_service_role\(\)|role'\s*\)?\s*(?:=|<>|IS DISTINCT FROM)\s*'service_role'/i;
const MIGRATION_PATH = resolve(
  ROOT,
  'aisha/db/migrations/00000000000000_baseline.sql',
);

interface WriteRpcSpec {
  id: string;
  sotFile: string;
  expectAdminOnly: boolean; // true → is_user_admin; false → is_admin_or_staff OR service_role
  expectAuditAction: string;
  expectsRationaleArg: boolean;
}

const RPCS: WriteRpcSpec[] = [
  {
    id: 'aisha_propose_static_defense_rule',
    sotFile: 'aisha_propose_static_defense_rule.sql',
    expectAdminOnly: false, // Aisha (service_role) + operator (admin/staff) both allowed
    expectAuditAction: 'static_defense_rule_proposed',
    expectsRationaleArg: false,
  },
  {
    id: 'aisha_publish_static_defense_rule',
    sotFile: 'aisha_publish_static_defense_rule.sql',
    expectAdminOnly: true, // Publish is a binding decision — admin only
    expectAuditAction: 'static_defense_rule_published',
    expectsRationaleArg: true,
  },
  {
    id: 'aisha_deprecate_static_defense_rule',
    sotFile: 'aisha_deprecate_static_defense_rule.sql',
    expectAdminOnly: true,
    expectAuditAction: 'static_defense_rule_deprecated',
    expectsRationaleArg: true,
  },
];

describe('Static defense write-side RPC integrity gate (Phase 7)', () => {
  test('bundling migration exists with all three RPC definitions', () => {
    expect(existsSync(MIGRATION_PATH), `Missing Phase 7 migration: ${MIGRATION_PATH}`).toBe(true);
    const content = readFileSync(MIGRATION_PATH, 'utf-8');
    for (const rpc of RPCS) {
      expect(
        content,
        `Migration must contain CREATE OR REPLACE FUNCTION for ${rpc.id}`,
      ).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${rpc.id}\\s*\\(`));
    }
  });

  test.each(RPCS)('$id — SoT file exists with canonical SECURITY DEFINER pattern', (rpc) => {
    const sotPath = resolve(FUNCTIONS_DIR, rpc.sotFile);
    expect(existsSync(sotPath), `Missing SoT: ${sotPath}`).toBe(true);
    const content = readFileSync(sotPath, 'utf-8');
    expect(content).toMatch(/SECURITY DEFINER/);
    expect(content).toMatch(/SET search_path TO 'public'/);
    // /s flag → . matches newlines (multi-line REVOKE/GRANT statements
    // for functions with many params span several lines)
    expect(content).toMatch(/REVOKE ALL ON FUNCTION.*FROM PUBLIC/s);
    expect(content).toMatch(/GRANT EXECUTE.*TO authenticated/s);
    expect(content).toMatch(/GRANT EXECUTE.*TO service_role/s);
  });

  test.each(RPCS)('$id — auth check enforces correct role', (rpc) => {
    const sotPath = resolve(FUNCTIONS_DIR, rpc.sotFile);
    const content = readFileSync(sotPath, 'utf-8');
    if (rpc.expectAdminOnly) {
      // Must require is_user_admin() — stricter than is_admin_or_staff()
      expect(
        content,
        `${rpc.id} must call is_user_admin() (publish/deprecate are admin-only)`,
      ).toMatch(/is_user_admin\(\)/);
      // Must NOT accept service_role bypass for these admin operations
      // (publish/deprecate must require explicit human override)
      const allowsService = SERVICE_BYPASS.test(content);
      expect(allowsService, `${rpc.id} must NOT allow service_role bypass`).toBe(false);
    } else {
      // Propose: service_role OR admin/staff
      expect(content).toMatch(/is_admin_or_staff\(\)/);
      expect(content).toMatch(SERVICE_BYPASS);
    }
  });

  test.each(RPCS)('$id — writes audit_journal with correct action label', (rpc) => {
    const sotPath = resolve(FUNCTIONS_DIR, rpc.sotFile);
    const content = readFileSync(sotPath, 'utf-8');
    expect(content).toMatch(/INSERT INTO public\.audit_journal/);
    expect(
      content,
      `${rpc.id} must log audit action '${rpc.expectAuditAction}'`,
    ).toMatch(new RegExp(`'${rpc.expectAuditAction}'`));
  });

  test.each(RPCS)('$id — validates rule_id format (kebab-case enforcement)', (rpc) => {
    if (rpc.id !== 'aisha_propose_static_defense_rule') {
      // Only propose validates input format; publish/deprecate read existing
      // rows so format is already enforced.
      return;
    }
    const sotPath = resolve(FUNCTIONS_DIR, rpc.sotFile);
    const content = readFileSync(sotPath, 'utf-8');
    expect(content).toMatch(/p_rule_id\s+!~/);
    expect(content).toMatch(/\^\[a-z\]\[a-z0-9-\]\+\$/);
  });

  test('publish RPC includes operator reminder about migration + regen', () => {
    const sotPath = resolve(FUNCTIONS_DIR, 'aisha_publish_static_defense_rule.sql');
    const content = readFileSync(sotPath, 'utf-8');
    // The audit_journal entry must remind the operator that CI will fail
    // until the new rule lands in a migration + the YAML is regenerated.
    // This is the "human in the loop" closing of the autonomous-publish loop.
    expect(content).toMatch(/reminder|Operator must|CI gate/i);
    expect(content).toMatch(/migration/i);
    expect(content).toMatch(/regenerat/i);
  });

  test('deprecate RPC requires rationale (min length enforced)', () => {
    const sotPath = resolve(FUNCTIONS_DIR, 'aisha_deprecate_static_defense_rule.sql');
    const content = readFileSync(sotPath, 'utf-8');
    // Rationale must be substantive — "explain why" gate, not a free skip
    expect(content).toMatch(/length\(p_deprecation_rationale\)\s*<\s*\d+/);
  });
});
