/**
 * Gate test: Phase 12 WP 2.3 — LLM token rate limit per JWT.sub.
 *
 * Enforces:
 *   1. SoT files exist for both tables, RLS, grants, both audited RPCs
 *   2. llm_quota PK = user_id, FK to aisha_auth.users CASCADE
 *   3. llm_tier_defaults seeded with 4 tiers (free/paid/admin/service)
 *      with the plan's exact limits
 *   4. RLS policies: user reads own, admin reads all, service writes
 *   5. fn_check_and_consume_llm_quota_audited:
 *        - SECURITY DEFINER + search_path
 *        - Validates inputs (RAISE on null/negative)
 *        - Lazy-creates from free tier
 *        - Atomic UPDATE-and-return via FOR UPDATE
 *        - Audit on denial ONLY (NOT on success — would explode audit table)
 *        - Returns {allowed, reason, remaining_tokens, remaining_cost, tier, reset_at}
 *   6. fn_get_llm_quota_status read-only, no write side-effect, admin can
 *      query others
 *   7. pg_cron 'llm-quota-daily-reset' scheduled at 00:00 UTC, guarded by
 *      EXTENSION existence
 *   8. Migration registered + idempotent
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();

const SOT_TABLE_QUOTA = path.join(ROOT, 'aisha/db/sql/tables/llm_quota.sql');
const SOT_TABLE_TIERS = path.join(
  ROOT,
  'aisha/db/sql/tables/llm_tier_defaults.sql',
);
const SOT_RLS = path.join(ROOT, 'aisha/db/sql/rls/llm_quota.sql');
const SOT_GRANTS = path.join(ROOT, 'aisha/db/sql/grants/llm_quota.sql');
const SOT_FN_CONSUME = path.join(
  ROOT,
  'aisha/db/sql/functions/fn_check_and_consume_llm_quota_audited.sql',
);
const SOT_FN_STATUS = path.join(
  ROOT,
  'aisha/db/sql/functions/fn_get_llm_quota_status.sql',
);
const SOT_SEED_TIERS = path.join(
  ROOT,
  'aisha/db/seed/core/26_llm_tier_defaults.sql',
);
const BASELINE = path.join(
  ROOT,
  'aisha/db/migrations/00000000000000_baseline.sql',
);
const REGISTRY = path.join(ROOT, 'aisha/db/migration-registry.json');

function readText(p: string): string {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

describe('Phase 12 WP 2.3 — SoT files exist', () => {
  it.each([
    ['llm_quota table', SOT_TABLE_QUOTA],
    ['llm_tier_defaults table', SOT_TABLE_TIERS],
    ['llm_quota RLS', SOT_RLS],
    ['llm_quota grants', SOT_GRANTS],
    ['fn_check_and_consume_llm_quota_audited', SOT_FN_CONSUME],
    ['fn_get_llm_quota_status', SOT_FN_STATUS],
  ])('%s SoT file exists', (_label, file) => {
    expect(fs.existsSync(file)).toBe(true);
  });
});

describe('Phase 12 WP 2.3 — llm_quota table', () => {
  const src = readText(SOT_TABLE_QUOTA);

  it('PRIMARY KEY = user_id (one row per user)', () => {
    expect(src).toMatch(/user_id\s+uuid\s+PRIMARY\s+KEY/i);
  });

  it('FK to aisha_auth.users ON DELETE CASCADE', () => {
    expect(src).toMatch(
      /REFERENCES\s+aisha_auth\.users\(id\)\s+ON\s+DELETE\s+CASCADE/i,
    );
  });

  it('tier FK to llm_tier_defaults ON UPDATE CASCADE', () => {
    expect(src).toMatch(
      /REFERENCES\s+public\.llm_tier_defaults\(tier\)\s+ON\s+UPDATE\s+CASCADE/i,
    );
  });

  it('CHECK constraints prevent negative consumption', () => {
    expect(src).toMatch(/consumed_tokens_today\s+int\s+NOT\s+NULL\s+DEFAULT\s+0\s+CHECK\s*\(\s*consumed_tokens_today\s*>=\s*0/i);
    expect(src).toMatch(/consumed_cost_today[\s\S]{0,80}CHECK\s*\(\s*consumed_cost_today\s*>=\s*0/i);
  });

  it('ENABLE ROW LEVEL SECURITY', () => {
    expect(src).toMatch(/ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  });
});

describe('Phase 12 WP 2.3 — llm_tier_defaults table', () => {
  const src = readText(SOT_TABLE_TIERS);

  it('PRIMARY KEY = tier (string)', () => {
    expect(src).toMatch(/tier\s+text\s+PRIMARY\s+KEY/i);
  });

  it('CHECK constraints prevent negative limits', () => {
    expect(src).toMatch(/daily_token_limit\s+int\s+NOT\s+NULL\s+CHECK\s*\(\s*daily_token_limit\s*>=\s*0/i);
    expect(src).toMatch(/daily_cost_limit[\s\S]{0,80}CHECK\s*\(\s*daily_cost_limit\s*>=\s*0/i);
  });
});

describe('Phase 12 WP 2.3 — RLS policies', () => {
  const src = readText(SOT_RLS);

  it('user reads OWN quota row only', () => {
    expect(src).toMatch(/user_read_own_quota[\s\S]{0,200}USING\s*\(\s*user_id\s*=\s*auth\.uid\(\)\s*\)/);
  });

  it('admin/staff/service_role reads ALL rows', () => {
    expect(src).toMatch(
      /admin_read_all_quota[\s\S]{0,400}get_jwt_role[\s\S]{0,100}IN\s*\([\s\S]{0,200}'admin'[\s\S]{0,200}'staff'[\s\S]{0,200}'service_role'/,
    );
  });

  it('service_role-only writes (FOR ALL with both USING + WITH CHECK)', () => {
    expect(src).toMatch(
      /service_role_write_quota[\s\S]{0,300}FOR\s+ALL[\s\S]{0,200}USING\s*\(\s*public\.get_jwt_role\(\)\s*=\s*'service_role'[\s\S]{0,200}WITH\s+CHECK/i,
    );
  });

  it('llm_tier_defaults: public read + admin write', () => {
    expect(src).toMatch(/public_read_tiers[\s\S]{0,200}USING\s*\(\s*true\s*\)/);
    expect(src).toMatch(/admin_write_tiers[\s\S]{0,300}get_jwt_role[\s\S]{0,100}IN\s*\([\s\S]{0,100}'admin'/);
  });
});

describe('Phase 12 WP 2.3 — Grants', () => {
  const src = readText(SOT_GRANTS);

  it('REVOKE ALL FROM PUBLIC before any GRANT', () => {
    expect(src).toMatch(/REVOKE\s+ALL\s+ON\s+TABLE\s+public\.llm_quota\s+FROM\s+PUBLIC/i);
    expect(src).toMatch(/REVOKE\s+ALL\s+ON\s+TABLE\s+public\.llm_tier_defaults\s+FROM\s+PUBLIC/i);
  });

  it('explicit GRANT SELECT TO authenticated', () => {
    expect(src).toMatch(/GRANT\s+SELECT\s+ON\s+TABLE\s+public\.llm_quota\s+TO\s+authenticated/i);
    expect(src).toMatch(/GRANT\s+SELECT\s+ON\s+TABLE\s+public\.llm_tier_defaults\s+TO\s+authenticated/i);
  });
});

describe('Phase 12 WP 2.3 — fn_check_and_consume_llm_quota_audited', () => {
  const src = readText(SOT_FN_CONSUME);

  it('SECURITY DEFINER + search_path', () => {
    expect(src).toMatch(/SECURITY\s+DEFINER/i);
    expect(src).toMatch(/SET\s+search_path\s+TO\s+'public'/i);
  });

  it('REVOKE ALL FROM PUBLIC + GRANT EXECUTE TO authenticated', () => {
    expect(src).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.fn_check_and_consume_llm_quota_audited[\s\S]{0,200}FROM\s+PUBLIC/i,
    );
    expect(src).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.fn_check_and_consume_llm_quota_audited[\s\S]{0,200}TO\s+authenticated/i,
    );
  });

  it('validates inputs (p_user_id null, negative tokens, negative cost)', () => {
    expect(src).toMatch(/p_user_id\s+IS\s+NULL[\s\S]{0,100}RAISE\s+EXCEPTION/i);
    expect(src).toMatch(/p_tokens\s+IS\s+NULL\s+OR\s+p_tokens\s*<\s*0[\s\S]{0,100}RAISE\s+EXCEPTION/i);
    expect(src).toMatch(/p_cost\s+IS\s+NULL\s+OR\s+p_cost\s*<\s*0[\s\S]{0,100}RAISE\s+EXCEPTION/i);
  });

  it('uses FOR UPDATE to lock the quota row', () => {
    expect(src).toMatch(/SELECT\s+\*\s+INTO\s+v_quota[\s\S]{0,200}FOR\s+UPDATE/);
  });

  it('lazy-creates from free tier defaults', () => {
    expect(src).toMatch(/IF\s+NOT\s+FOUND[\s\S]{0,400}llm_tier_defaults[\s\S]{0,100}'free'/);
    expect(src).toMatch(/INSERT\s+INTO\s+public\.llm_quota/i);
  });

  it('resets counters when last_reset_at < date_trunc(day, now())', () => {
    expect(src).toMatch(
      /last_reset_at\s*<\s*date_trunc\s*\(\s*'day'\s*,\s*now\(\)\s*\)[\s\S]{0,400}consumed_tokens_today\s*=\s*0[\s\S]{0,200}consumed_cost_today\s*=\s*0/,
    );
  });

  it('audits ONLY on denial (NOT on success)', () => {
    // The INSERT INTO audit_journal block must be inside `IF NOT v_allowed THEN`
    expect(src).toMatch(
      /IF\s+NOT\s+v_allowed\s+THEN[\s\S]{0,800}INSERT\s+INTO\s+public\.audit_journal/i,
    );
  });

  it('audit metadata has tier/reason/limits but NO PII', () => {
    const auditBlock = src.match(/INSERT\s+INTO\s+public\.audit_journal[\s\S]+?\);/i);
    expect(auditBlock).not.toBeNull();
    const blk = auditBlock![0];
    expect(blk).toMatch(/'tier'/);
    expect(blk).toMatch(/'reason'/);
    expect(blk).toMatch(/'requested_tokens'/);
    expect(blk).toMatch(/'daily_token_limit'/);
    // CRITICAL: no email, no prompt content, no user_email
    expect(blk).not.toMatch(/email|prompt_text|content|message/i);
  });

  it('returns jsonb with {allowed, reason, remaining_tokens, remaining_cost, tier, reset_at}', () => {
    const returnBlock = src.match(/RETURN\s+jsonb_build_object\([\s\S]+?\);/i);
    expect(returnBlock).not.toBeNull();
    const blk = returnBlock![0];
    expect(blk).toMatch(/'allowed'/);
    expect(blk).toMatch(/'reason'/);
    expect(blk).toMatch(/'remaining_tokens'/);
    expect(blk).toMatch(/'remaining_cost'/);
    expect(blk).toMatch(/'tier'/);
    expect(blk).toMatch(/'reset_at'/);
  });

  it('distinguishes token vs cost denial via reason string', () => {
    expect(src).toMatch(/'token_limit_exceeded'/);
    expect(src).toMatch(/'cost_limit_exceeded'/);
  });
});

describe('Phase 12 WP 2.3 — fn_get_llm_quota_status (read-only)', () => {
  const src = readText(SOT_FN_STATUS);

  it('marked STABLE (read-only)', () => {
    expect(src).toMatch(/SECURITY\s+DEFINER\s+SET\s+search_path\s+TO\s+'public'\s+STABLE/i);
  });

  it('admin can query OTHER users (auth-first pattern post-refactor)', () => {
    // Refactor 2026-05-20: switched from `v_target_id := COALESCE(p_user_id,
    // auth.uid())` (parameter-first — flagged by security-hardened-helpers
    // gate) to auth-first guard `IF p_user_id IS NOT NULL AND p_user_id
    // != auth.uid() THEN check role THEN v_target_id := p_user_id`.
    expect(src).toMatch(
      /p_user_id\s+IS\s+NOT\s+NULL\s+AND\s+p_user_id\s*!=\s*auth\.uid\(\)[\s\S]{0,300}admin/,
    );
  });

  it('falls back to free-tier defaults if no row exists (no write side-effect)', () => {
    expect(src).toMatch(/IF\s+NOT\s+FOUND[\s\S]{0,400}llm_tier_defaults[\s\S]{0,200}'free'/i);
    // Function is STABLE so it can't INSERT — verify no INSERT/UPDATE statements
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^--.*$/gm, '');
    expect(stripped).not.toMatch(/\bINSERT\s+INTO\s+public\.llm_quota\b/i);
    expect(stripped).not.toMatch(/\bUPDATE\s+public\.llm_quota\s+SET/i);
  });

  it('NO audit_journal writes (read-only RPC must not log)', () => {
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^--.*$/gm, '');
    expect(stripped).not.toMatch(/INSERT\s+INTO\s+(?:public\.)?audit_journal/i);
  });
});

describe('Phase 12 WP 2.3 — baseline-only state + seed SoT', () => {
  it('registry is baseline-only (WP 2.3 migration absorbed into baseline + archived)', () => {
    // The active migration registry carries NO non-baseline migrations: the WP
    // 2.3 DDL is folded into aisha/db/migrations/00000000000000_baseline.sql and
    // the original migration is archived. Reading the REAL registry note asserts
    // the canonical baseline-only invariant (not a shim-injected migration name).
    expect(readText(REGISTRY)).toMatch(
      /Baseline-only state:\s*no non-baseline migrations/i,
    );
  });

  it('seed SoT seeds 4 tiers (free/paid/admin/service) with plan-spec limits', () => {
    // SoT for the reference rows is aisha/db/seed/core/26_llm_tier_defaults.sql,
    // applied on the cold-start apply+seed path (the archived migration's INSERT
    // does not run on a fresh --wipe).
    const src = readText(SOT_SEED_TIERS);
    expect(src).toMatch(/'free',\s*50000,\s*0\.50/);
    expect(src).toMatch(/'paid',\s*500000,\s*10\.00/);
    expect(src).toMatch(/'admin',\s*5000000,\s*100\.00/);
    expect(src).toMatch(/'service',\s*50000000,\s*1000\.00/);
  });

  it('seed uses ON CONFLICT DO UPDATE (operator can tweak + re-run)', () => {
    expect(readText(SOT_SEED_TIERS)).toMatch(
      /ON\s+CONFLICT\s*\(\s*tier\s*\)\s+DO\s+UPDATE/i,
    );
  });

  it('daily quota reset is canonical in the SoT function (on-read, midnight UTC)', () => {
    // The pg_cron 'llm-quota-daily-reset' belt-and-suspenders job was dropped when
    // the platform moved off runtime pg_cron (the baseline declares 0 cron jobs).
    // The LIVE, deployed daily-reset invariant is the on-read reset inside
    // fn_check_and_consume_llm_quota_audited: when the row's last_reset_at predates
    // the start of today, the counters reset to the current day. Assert that
    // canonical mechanism in SoT — not the dropped (archived) cron declaration.
    const src = readText(SOT_FN_CONSUME);
    expect(src).toMatch(/last_reset_at\s*<\s*date_trunc\(\s*'day'\s*,\s*now\(\)\s*\)/);
    expect(src).toMatch(/last_reset_at\s*=\s*date_trunc\(\s*'day'\s*,\s*now\(\)\s*\)/);
  });

  it('all DDL bodies live in canonical SoT (self-contained cold-start apply)', () => {
    // The invariant the archived migration's "self-contained re-run" expressed is
    // now satisfied by the dedicated SoT files: each table/function body is
    // present in aisha/db/sql/ (and compiled into the baseline). Assert the SoT
    // bodies directly rather than the absorbed migration's copy.
    expect(readText(SOT_TABLE_QUOTA)).toMatch(
      /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.llm_quota/i,
    );
    expect(readText(SOT_TABLE_TIERS)).toMatch(
      /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.llm_tier_defaults/i,
    );
    expect(readText(SOT_FN_CONSUME)).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_check_and_consume_llm_quota_audited/i,
    );
    expect(readText(SOT_FN_STATUS)).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_get_llm_quota_status/i,
    );
    // And the same bodies are compiled into the real baseline (canonical, not the
    // shim-redirected historical migration).
    const baseline = readText(BASELINE);
    expect(baseline).toMatch(
      /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.llm_quota/i,
    );
    expect(baseline).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_check_and_consume_llm_quota_audited/i,
    );
  });
});
