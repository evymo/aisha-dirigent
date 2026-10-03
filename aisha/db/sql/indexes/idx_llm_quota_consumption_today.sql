-- Index: idx_llm_quota_consumption_today
-- Phase 12 WP 2.3 — partial index for "top consumers today" admin queries.
-- WHERE clause keeps the index small (only users who actually used tokens today).

CREATE INDEX IF NOT EXISTS idx_llm_quota_consumption_today
  ON public.llm_quota (consumed_tokens_today DESC, consumed_cost_today DESC)
  WHERE consumed_tokens_today > 0;
