-- ============================================================================
-- Omni acceptance (pgTAP) — quota-admission
--
-- Contract source of truth: docs/planning/AISHA_OMNI_GATEWAY.md §9, §5.6, §4, §20.
--
-- ISOLATION: this file lives under aisha/db/tests/schema/omni/ and is NOT picked
-- up by the default runner (scripts/db/run-schema-tests.mjs reads ONLY *.sql
-- directly in aisha/db/tests/schema, non-recursive). It runs only in acceptance
-- mode (e.g. an OMNI-acceptance runner pointed at this subdir). Same BEGIN…
-- ROLLBACK + CREATE EXTENSION-inside-txn convention as the sibling suites so
-- pgTAP's functions never persist in the asserted schema.
--
-- LIVE vs SKIP:
--   - fn_check_and_consume_llm_quota_audited, llm_quota, ai_runs.cost_total_json,
--     audit_journal EXIST today → LIVE pgTAP assertions on their real shape.
--   - fn_admit_branch does NOT exist → asserted ABSENT (honest negative). When it
--     lands, replace that line with has_function(...) and bump the plan.
-- ============================================================================
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(14);

-- ── LIVE: pre-flight quota RPC the enforceQuota() middleware sits on (§9) ────
SELECT has_function(
  'public', 'fn_check_and_consume_llm_quota_audited',
  ARRAY['uuid', 'integer', 'numeric'],
  'fn: pre-flight quota gate exists with (uuid,int,numeric) signature (§9)'
);
SELECT function_returns(
  'public', 'fn_check_and_consume_llm_quota_audited',
  ARRAY['uuid', 'integer', 'numeric'], 'jsonb',
  'fn: pre-flight quota gate returns the jsonb {allowed,reason,…} verdict (§9)'
);
SELECT is_definer(
  'public', 'fn_check_and_consume_llm_quota_audited',
  ARRAY['uuid', 'integer', 'numeric'],
  'fn: quota gate is SECURITY DEFINER (gates on end-user, not service token)'
);

-- ── LIVE: per-user quota ledger backing the gate (§9, §18) ──────────────────
SELECT has_table('public', 'llm_quota', 'table: llm_quota (per-user daily ledger)');
SELECT has_column('public', 'llm_quota', 'daily_token_limit', 'col: llm_quota.daily_token_limit');
SELECT has_column('public', 'llm_quota', 'daily_cost_limit', 'col: llm_quota.daily_cost_limit');
SELECT has_column('public', 'llm_quota', 'consumed_tokens_today', 'col: llm_quota.consumed_tokens_today');
SELECT has_column('public', 'llm_quota', 'consumed_cost_today', 'col: llm_quota.consumed_cost_today');

-- ── LIVE: post-run reconciliation sink (§9 'rekonciliace PO', §4) ───────────
SELECT has_table('public', 'ai_runs', 'table: ai_runs (run ledger)');
SELECT has_column('public', 'ai_runs', 'cost_total_json',
  'col: ai_runs.cost_total_json — canonical post-run cost/token sink for reconciliation (§9)');
SELECT col_not_null('public', 'ai_runs', 'cost_total_json',
  'col: ai_runs.cost_total_json NOT NULL (reconciliation always has a target)');

-- ── LIVE: denial-audit sink (§9 'auditováno'; §5.6 spend_denied) ────────────
SELECT has_table('public', 'audit_journal', 'table: audit_journal (quota-denial audit sink)');
SELECT has_column('public', 'audit_journal', 'action', 'col: audit_journal.action');

-- ── FALSE-POSITIVE / honest-negative GUARD: concurrency cap NOT yet present ──
-- §9 mandates fn_admit_branch (fork-bomb cap). It does not exist today; assert
-- its ABSENCE so this suite tells the truth about the unimplemented surface.
-- Flip to has_function('public','fn_admit_branch',…) + bump plan when it lands.
SELECT hasnt_function(
  'public', 'fn_admit_branch',
  'fn: fn_admit_branch concurrency cap is NOT implemented yet (§9 — SKIP-until-impl)'
);

SELECT * FROM finish();
ROLLBACK;
