-- ============================================================================
-- Source of Truth: ai_cost_class_catalog
-- Purpose: Seed-extensible mapping of task kinds (ai_runs.kind ∪
--          ai_tasks.task_type ∪ agent_runs.kind) to cost classes with
--          expected USD/token bands. This is the COLD-START side of cost
--          estimation: fn_estimate_task_cost prefers 30-day percentiles from
--          real ai_runs history and falls back to these bands when a kind has
--          too few samples. The bands also provide the DEFAULT allow/ask/deny
--          thresholds when no ai_spend_policies row matches (decided
--          2026-06-12: default posture = allow + ask above the class p90).
-- Managed by: seed aisha/db/seed/core/29_ai_cost_class_catalog.sql; admins
--             may tune rows via service_role / future audited RPC.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ai_cost_class_catalog (
  kind        text        PRIMARY KEY,
  -- Coarse class for UI badges + reasoning: micro|small|medium|large|xl
  cost_class  text        NOT NULL DEFAULT 'small',
  -- Expected cost band (USD): p50 = typical, p90 = conservative estimate.
  usd_p50     numeric(10,4) NOT NULL DEFAULT 0,
  usd_p90     numeric(10,4) NOT NULL DEFAULT 0,
  -- Expected token band (subscription-domain runs are budgeted in tokens).
  tokens_p90  int,
  description text,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ai_cost_class_catalog_class_check
    CHECK (cost_class IN ('micro', 'small', 'medium', 'large', 'xl')),
  CONSTRAINT ai_cost_class_catalog_band_order
    CHECK (usd_p50 >= 0 AND usd_p90 >= usd_p50)
);

COMMENT ON TABLE public.ai_cost_class_catalog IS
  'Seed-extensible kind→cost-class bands. Cold-start estimates + default spend thresholds; real history (ai_runs percentiles) takes precedence in fn_estimate_task_cost.';

ALTER TABLE public.ai_cost_class_catalog ENABLE ROW LEVEL SECURITY;
