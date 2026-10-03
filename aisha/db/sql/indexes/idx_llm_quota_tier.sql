-- Index: idx_llm_quota_tier
-- Phase 12 WP 2.3 — supports filter / group-by tier when reading quota.

CREATE INDEX IF NOT EXISTS idx_llm_quota_tier
  ON public.llm_quota (tier);
