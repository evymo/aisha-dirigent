/**
 * Gate test: Mission Control — per-scope AI budget cap (ai_budget).
 *
 * Enforces (static SoT contracts, mirrors wp-2-3-llm-quota.gate.test.ts):
 *   1. SoT files exist: table, RLS, grants, 3 RPCs
 *   2. ai_budget: scope_type/period CHECKs, >=0 CHECKs, UNIQUE(scope,period), RLS
 *   3. RLS: admin/staff/service read all, story participant reads own, service writes
 *   4. Grants: REVOKE ALL FROM PUBLIC + explicit GRANT SELECT
 *   5. set_ai_budget_audited: SECURITY DEFINER, is_admin_or_staff guard, upsert, audit
 *   6. fn_get_ai_budget_status: STABLE read-only (no writes, no audit)
 *   7. fn_check_and_consume_ai_budget_audited: validates inputs, reuses per-user
 *      quota, FOR UPDATE, audits denial ONLY, returns {allowed, reason}
 *   8. Baseline-only state + objects self-contained in canonical SoT/baseline
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();

const SOT_TABLE = path.join(ROOT, 'aisha/db/sql/tables/ai_budget.sql');
const SOT_RLS = path.join(ROOT, 'aisha/db/sql/rls/ai_budget.sql');
const SOT_GRANTS = path.join(ROOT, 'aisha/db/sql/grants/ai_budget.sql');
const SOT_FN_SET = path.join(ROOT, 'aisha/db/sql/functions/set_ai_budget_audited.sql');
const SOT_FN_STATUS = path.join(ROOT, 'aisha/db/sql/functions/fn_get_ai_budget_status.sql');
const SOT_FN_CONSUME = path.join(
  ROOT,
  'aisha/db/sql/functions/fn_check_and_consume_ai_budget_audited.sql',
);
const BASELINE = path.join(ROOT, 'aisha/db/migrations/00000000000000_baseline.sql');
const REGISTRY = path.join(ROOT, 'aisha/db/migration-registry.json');

function readText(p: string): string {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

describe('ai_budget — SoT files exist', () => {
  it.each([
    ['table', SOT_TABLE],
    ['RLS', SOT_RLS],
    ['grants', SOT_GRANTS],
    ['set_ai_budget_audited', SOT_FN_SET],
    ['fn_get_ai_budget_status', SOT_FN_STATUS],
    ['fn_check_and_consume_ai_budget_audited', SOT_FN_CONSUME],
  ])('%s SoT file exists', (_label, file) => {
    expect(fs.existsSync(file)).toBe(true);
  });
});

describe('ai_budget — table', () => {
  const src = readText(SOT_TABLE);

  it('scope_type CHECK restricts to story/partner/agent', () => {
    expect(src).toMatch(
      /scope_type[\s\S]{0,60}CHECK\s*\(\s*scope_type\s+IN\s*\([\s\S]{0,30}'story'[\s\S]{0,30}'partner'[\s\S]{0,30}'agent'/i,
    );
  });

  it('period CHECK restricts to lifetime/daily/monthly', () => {
    expect(src).toMatch(
      /period[\s\S]{0,80}CHECK\s*\(\s*period\s+IN\s*\([\s\S]{0,30}'lifetime'[\s\S]{0,30}'daily'[\s\S]{0,30}'monthly'/i,
    );
  });

  it('limits are nullable + non-negative; consumed counters non-negative', () => {
    expect(src).toMatch(/token_limit[\s\S]{0,60}CHECK\s*\(\s*token_limit\s+IS\s+NULL\s+OR\s+token_limit\s*>=\s*0/i);
    expect(src).toMatch(/cost_limit[\s\S]{0,80}CHECK\s*\(\s*cost_limit\s+IS\s+NULL\s+OR\s+cost_limit\s*>=\s*0/i);
    expect(src).toMatch(/consumed_tokens[\s\S]{0,60}DEFAULT\s+0[\s\S]{0,40}CHECK\s*\(\s*consumed_tokens\s*>=\s*0/i);
    expect(src).toMatch(/consumed_cost[\s\S]{0,80}DEFAULT\s+0[\s\S]{0,40}CHECK\s*\(\s*consumed_cost\s*>=\s*0/i);
  });

  it('UNIQUE(scope_type, scope_id, period) + RLS enabled', () => {
    expect(src).toMatch(/UNIQUE\s*\(\s*scope_type\s*,\s*scope_id\s*,\s*period\s*\)/i);
    expect(src).toMatch(/ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  });
});

describe('ai_budget — RLS policies', () => {
  const src = readText(SOT_RLS);

  it('admin/staff/service read all', () => {
    expect(src).toMatch(
      /admin_read_all_budget[\s\S]{0,300}get_jwt_role\(\)\s+IN\s*\([\s\S]{0,60}'admin'[\s\S]{0,40}'staff'[\s\S]{0,40}'service_role'/,
    );
  });

  it('story participant reads OWN story budget', () => {
    expect(src).toMatch(
      /participant_read_own_story_budget[\s\S]{0,400}story_participants[\s\S]{0,120}user_id\s*=\s*auth\.uid\(\)/,
    );
  });

  it('service_role-only writes (FOR ALL with USING + WITH CHECK)', () => {
    expect(src).toMatch(
      /service_role_write_budget[\s\S]{0,300}FOR\s+ALL[\s\S]{0,200}USING\s*\(\s*public\.get_jwt_role\(\)\s*=\s*'service_role'[\s\S]{0,200}WITH\s+CHECK/i,
    );
  });
});

describe('ai_budget — grants', () => {
  const src = readText(SOT_GRANTS);
  it('REVOKE ALL FROM PUBLIC + explicit GRANT SELECT', () => {
    expect(src).toMatch(/REVOKE\s+ALL\s+ON\s+TABLE\s+public\.ai_budget\s+FROM\s+PUBLIC/i);
    expect(src).toMatch(/GRANT\s+SELECT\s+ON\s+TABLE\s+public\.ai_budget\s+TO\s+authenticated/i);
  });
});

describe('set_ai_budget_audited', () => {
  const src = readText(SOT_FN_SET);

  it('SECURITY DEFINER + search_path + REVOKE/GRANT', () => {
    expect(src).toMatch(/SECURITY\s+DEFINER/i);
    expect(src).toMatch(/SET\s+search_path\s+TO\s+'public'/i);
    expect(src).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.set_ai_budget_audited[\s\S]{0,120}FROM\s+PUBLIC/i);
    expect(src).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.set_ai_budget_audited[\s\S]{0,120}TO\s+authenticated/i);
  });

  it('guarded by is_admin_or_staff()', () => {
    expect(src).toMatch(/IF\s+NOT\s+public\.is_admin_or_staff\(\)\s+THEN[\s\S]{0,120}RAISE\s+EXCEPTION/i);
  });

  it('upserts on UNIQUE conflict + audits the mutation', () => {
    expect(src).toMatch(/ON\s+CONFLICT\s*\(\s*scope_type\s*,\s*scope_id\s*,\s*period\s*\)\s+DO\s+UPDATE/i);
    expect(src).toMatch(/INSERT\s+INTO\s+public\.audit_journal[\s\S]{0,200}'ai\.budget\.set'/i);
  });
});

describe('fn_get_ai_budget_status (read-only)', () => {
  const src = readText(SOT_FN_STATUS);

  it('marked STABLE', () => {
    expect(src).toMatch(/STABLE/);
  });

  it('no write side-effects + no audit (read-only RPC)', () => {
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^--.*$/gm, '');
    expect(stripped).not.toMatch(/\bINSERT\s+INTO\s+public\.ai_budget\b/i);
    expect(stripped).not.toMatch(/\bUPDATE\s+public\.ai_budget\s+SET/i);
    expect(stripped).not.toMatch(/INSERT\s+INTO\s+(?:public\.)?audit_journal/i);
  });

  it('returns a state field', () => {
    expect(src).toMatch(/'state'/);
  });
});

describe('fn_check_and_consume_ai_budget_audited', () => {
  const src = readText(SOT_FN_CONSUME);

  it('SECURITY DEFINER + REVOKE/GRANT', () => {
    expect(src).toMatch(/SECURITY\s+DEFINER/i);
    expect(src).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.fn_check_and_consume_ai_budget_audited[\s\S]{0,140}FROM\s+PUBLIC/i);
    expect(src).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.fn_check_and_consume_ai_budget_audited[\s\S]{0,140}TO\s+authenticated/i);
  });

  it('validates inputs (user null, negative tokens, negative cost)', () => {
    expect(src).toMatch(/p_user_id\s+IS\s+NULL[\s\S]{0,100}RAISE\s+EXCEPTION/i);
    expect(src).toMatch(/p_tokens\s+IS\s+NULL\s+OR\s+p_tokens\s*<\s*0[\s\S]{0,100}RAISE\s+EXCEPTION/i);
    expect(src).toMatch(/p_cost\s+IS\s+NULL\s+OR\s+p_cost\s*<\s*0[\s\S]{0,100}RAISE\s+EXCEPTION/i);
  });

  it('composes with the per-user quota gate + locks story rows', () => {
    expect(src).toMatch(/fn_check_and_consume_llm_quota_audited/);
    expect(src).toMatch(/FOR\s+UPDATE/);
  });

  it('audits denial ONLY with reason story_budget, no PII', () => {
    expect(src).toMatch(/IF\s+NOT\s+v_story_allowed\s+THEN[\s\S]{0,400}INSERT\s+INTO\s+public\.audit_journal/i);
    const auditBlock = src.match(/INSERT\s+INTO\s+public\.audit_journal[\s\S]+?\);/i);
    expect(auditBlock).not.toBeNull();
    expect(auditBlock![0]).toMatch(/'ai\.budget\.denied'/);
    expect(auditBlock![0]).toMatch(/'story_budget'/);
    expect(auditBlock![0]).not.toMatch(/email|prompt_text|content|message/i);
  });

  it('returns jsonb with {allowed, reason}', () => {
    const ret = src.match(/RETURN\s+jsonb_build_object\([\s\S]+?\);/i);
    expect(ret).not.toBeNull();
    expect(ret![0]).toMatch(/'allowed'/);
    expect(ret![0]).toMatch(/'reason'/);
  });
});

describe('ai_budget — baseline-only state + self-contained in canonical SoT', () => {
  it('baseline exists + registry is baseline-only (migration absorbed)', () => {
    expect(fs.existsSync(BASELINE)).toBe(true);
    expect(readText(REGISTRY)).toMatch(/Baseline-only state/i); // migration absorbed into baseline; active registry is baseline-only
  });

  it('table + all three RPC bodies declared idempotently in SoT', () => {
    expect(readText(SOT_TABLE)).toMatch(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.ai_budget/i);
    expect(readText(SOT_FN_SET)).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.set_ai_budget_audited/i);
    expect(readText(SOT_FN_STATUS)).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_get_ai_budget_status/i);
    expect(readText(SOT_FN_CONSUME)).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_check_and_consume_ai_budget_audited/i,
    );
  });

  it('table + all three RPC bodies compiled into the canonical baseline', () => {
    const src = readText(BASELINE);
    expect(src).toMatch(/CREATE\s+TABLE[\s\S]{0,40}public\.ai_budget/i);
    expect(src).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.set_ai_budget_audited/i);
    expect(src).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_get_ai_budget_status/i);
    expect(src).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_check_and_consume_ai_budget_audited/i);
  });
});
