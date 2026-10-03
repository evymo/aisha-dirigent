/**
 * Gate test: Mission Control — role-gated, audited cancel for ai_runs.
 *
 * Enforces:
 *   1. cancel_ai_run SoT exists, SECURITY DEFINER + REVOKE/GRANT
 *   2. Authorization = owner-self OR is_admin_or_staff (impersonation by role);
 *      a non-owner non-admin is denied. Owner is DERIVED from the run row, never
 *      trusted from a parameter (no parameter-trusting impersonation).
 *   3. Only in-flight runs cancellable → status 'canceled'
 *   4. Audited with actor/subject separation ({acted_by, on_behalf_of}),
 *      action 'ai.run.cancelled', no PII
 *   5. Migration registered
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
// cancel_ai_run was migrated and absorbed into the baseline; its canonical
// SoT now lives in aisha/db/sql/functions/. Gates read current SoT only —
// never archive/ (the archived migration is no longer a read target).
const SOT = path.join(ROOT, 'aisha/db/sql/functions/cancel_ai_run.sql');
const REGISTRY = path.join(ROOT, 'aisha/db/migration-registry.json');

function readText(p: string): string {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

describe('cancel_ai_run — contract', () => {
  const src = readText(SOT);

  it('SoT file exists', () => {
    expect(fs.existsSync(SOT)).toBe(true);
  });

  it('SECURITY DEFINER + search_path + REVOKE/GRANT', () => {
    expect(src).toMatch(/SECURITY\s+DEFINER/i);
    expect(src).toMatch(/SET\s+search_path\s+TO\s+'public'/i);
    expect(src).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.cancel_ai_run[\s\S]{0,80}FROM\s+PUBLIC/i);
    expect(src).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.cancel_ai_run[\s\S]{0,80}TO\s+authenticated/i);
  });

  it('derives owner from the run row (not a parameter)', () => {
    expect(src).toMatch(/SELECT\s+actor_user_id\s*,\s*status\s+INTO\s+v_owner\s*,\s*v_status[\s\S]{0,120}FROM\s+public\.ai_runs[\s\S]{0,60}WHERE\s+id\s*=\s*p_run_id/i);
  });

  it('authorizes owner-self OR admin/staff; denies otherwise', () => {
    expect(src).toMatch(/public\.is_admin_or_staff\(\)/);
    expect(src).toMatch(/IF\s+NOT\s*\(\s*v_caller\s*=\s*v_owner\s+OR\s+v_is_admin\s*\)\s+THEN[\s\S]{0,120}RAISE\s+EXCEPTION/i);
  });

  it('computes on-behalf-of impersonation flag', () => {
    expect(src).toMatch(/v_on_behalf\s*:=\s*\(\s*v_is_admin\s+AND\s+v_caller\s+IS\s+DISTINCT\s+FROM\s+v_owner\s*\)/i);
  });

  it('cancels only in-flight runs → canceled', () => {
    expect(src).toMatch(/status\s+NOT\s+IN\s*\(\s*'pending'\s*,\s*'queued'\s*,\s*'running'\s*\)/i);
    expect(src).toMatch(/status\s*=\s*'canceled'/i);
  });

  it('audits with actor/subject separation + no PII', () => {
    const audit = src.match(/INSERT\s+INTO\s+public\.audit_journal[\s\S]+?\);/i);
    expect(audit).not.toBeNull();
    const blk = audit![0];
    expect(blk).toMatch(/'ai\.run\.cancelled'/);
    expect(blk).toMatch(/'acted_by'/);
    expect(blk).toMatch(/'on_behalf_of'/);
    expect(blk).toMatch(/'impersonated'/);
    expect(blk).not.toMatch(/email|prompt_text|content/i);
  });

  it('migration absorbed into baseline (object in SoT, registry baseline-only)', () => {
    // The cancel_ai_run migration was absorbed into the baseline. Assert the
    // object is present in canonical SoT (it was migrated/registered) and the
    // active registry is baseline-only — never assert the archived migration.
    expect(fs.existsSync(SOT)).toBe(true);
    expect(src).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.cancel_ai_run/i);
    expect(readText(REGISTRY)).toMatch(/Baseline-only state/i);
  });
});
