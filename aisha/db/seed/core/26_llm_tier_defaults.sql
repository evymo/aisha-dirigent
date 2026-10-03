-- ============================================================================
-- STEP 26: LLM Tier Defaults — per-tier daily token + cost budgets
-- Phase 12 WP 2.3 — LLM token rate limit per JWT.sub
--
-- WHY THIS LIVES IN SEED (not only in the migration):
--   The llm_tier_defaults TABLE + RLS + grants are folded into the baseline
--   (aisha/db/sql/tables/llm_tier_defaults.sql et al.). The original WP 2.3
--   migration ALSO carried the 4-row seed, but under the 0.9.0 baseline-only
--   policy that migration is archived (the absorbed migration (now in the baseline))
--   and does NOT run on a fresh `--wipe` cold-start. Folding DDL into the
--   baseline keeps the table, but the migration's INSERT is lost — leaving the
--   table EMPTY after a wipe.
--
--   With no rows, the first authenticated LLM call hits the guard in
--   fn_check_and_consume_llm_quota_audited ("llm_tier_defaults seed missing —
--   free tier not configured"), breaking quota gating for every user. Reference
--   data that the runtime asserts on belongs in seed/, so the cold-start
--   apply+seed path repopulates it.
--
-- Idempotent: ON CONFLICT (tier) DO UPDATE — re-seeding picks up threshold
--   tweaks, and on an UPGRADE path (where the archived migration already
--   inserted these rows) the values below are byte-identical, so the UPDATE is
--   a no-op beyond updated_at. Keep these limits in lockstep with the gate
--   (src/tests/gates/wp-2-3-llm-quota.gate.test.ts) and the archived migration.
-- ============================================================================

INSERT INTO public.llm_tier_defaults (tier, daily_token_limit, daily_cost_limit, description) VALUES
  ('free',    50000,    0.50,    'Public tier — 50K tokens/day, $0.50 cost cap'),
  ('paid',    500000,   10.00,   'Paying customer — 500K tokens/day, $10 cost cap'),
  ('admin',   5000000,  100.00,  'Admin/staff — 5M tokens/day, $100 cost cap'),
  ('service', 50000000, 1000.00, 'Service-role internal — 50M tokens/day, $1000 cost cap')
ON CONFLICT (tier) DO UPDATE SET
  daily_token_limit    = EXCLUDED.daily_token_limit,
  daily_cost_limit = EXCLUDED.daily_cost_limit,
  description          = EXCLUDED.description,
  updated_at           = now();
