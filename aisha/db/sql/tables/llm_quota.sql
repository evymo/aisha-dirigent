-- ============================================================================
-- Table: llm_quota
-- Phase 12 WP 2.3 — LLM token rate limit per JWT.sub
--
-- Per-user daily token + cost ledger. The row is lazy-created from
-- llm_tier_defaults on first LLM call via fn_check_and_consume_llm_quota_audited.
-- Counters reset at midnight UTC via pg_cron job 'llm-quota-daily-reset'
-- (declared in aisha/db/sql/cron/llm_quota_daily_reset.sql).
--
-- Read paths:
--   - End user reads OWN row (RLS).
--   - Admin reads ALL rows (RLS).
-- Write paths (mutation): service_role only via the audited RPC.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.llm_quota (
  user_id uuid PRIMARY KEY
    REFERENCES aisha_auth.users(id) ON DELETE CASCADE,
  tier text NOT NULL DEFAULT 'free'
    REFERENCES public.llm_tier_defaults(tier) ON UPDATE CASCADE,
  daily_token_limit int NOT NULL CHECK (daily_token_limit >= 0),
  daily_cost_limit numeric(10,4) NOT NULL CHECK (daily_cost_limit >= 0),
  consumed_tokens_today int NOT NULL DEFAULT 0 CHECK (consumed_tokens_today >= 0),
  consumed_cost_today numeric(10,4) NOT NULL DEFAULT 0 CHECK (consumed_cost_today >= 0),
  last_reset_at timestamptz NOT NULL DEFAULT date_trunc('day', now()),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes live in aisha/db/sql/indexes/idx_llm_quota_tier.sql +
--                  aisha/db/sql/indexes/idx_llm_quota_consumption_today.sql
-- (architecture test sql-source-separation enforces strict separation).

ALTER TABLE public.llm_quota ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.llm_quota IS
  'Phase 12 WP 2.3 — per-user daily LLM token + cost ledger. Row lazy-created from llm_tier_defaults on first call. Service-role mutations only.';
