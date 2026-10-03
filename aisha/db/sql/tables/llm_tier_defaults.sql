-- ============================================================================
-- Table: llm_tier_defaults
-- Phase 12 WP 2.3 — LLM token rate limit per JWT.sub
--
-- Per-tier daily token + cost budgets. New users land in the 'free' tier
-- via fn_check_and_consume_llm_quota_audited's lazy-create path. Admin
-- promotes users to higher tiers via update_llm_quota_tier_audited (future
-- WP follow-up — not in this PR).
--
-- Read-only for end users; admin can edit via SECURITY DEFINER mutation RPCs.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.llm_tier_defaults (
  tier text PRIMARY KEY,
  daily_token_limit int NOT NULL CHECK (daily_token_limit >= 0),
  daily_cost_limit numeric(10,4) NOT NULL CHECK (daily_cost_limit >= 0),
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.llm_tier_defaults ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.llm_tier_defaults IS
  'Phase 12 WP 2.3 — per-tier daily token + cost budgets for LLM quota enforcement. Public read, admin write.';
