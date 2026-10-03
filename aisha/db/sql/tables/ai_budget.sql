-- ============================================================================
-- Table: ai_budget
-- Mission Control governance — scope-generic AI spend cap.
--
-- A budget is a scope-ovatelný strop: `story` is the first scope (scope_id =
-- partner_stories.id), extensible to `partner` / `agent`. Mirrors the llm_quota
-- ledger pattern (per-user daily) but at (scope, period) granularity and
-- ALONGSIDE the per-user quota — an additional limit, not a replacement. The
-- per-story cap is metered + enforced at the orchestration control layer
-- (admission in fn_create_workflow_run, node boundary in the reflection runner).
--
-- Read paths:
--   - Admin/staff/service: all rows (ops + Mission Control board).
--   - Story participant: own story's row (board chip).
-- Write paths (mutation): service_role only, via the audited RPCs
--   (set_ai_budget_audited, fn_check_and_consume_ai_budget_audited).
--
-- scope_id is polymorphic (story=partner_stories.id, partner=partners.id,
-- agent=ai agent id) → no FK; integrity enforced by scope_type + the writing RPC.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ai_budget (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- scope_type: story/context is the ENFORCED governance axis (multi-instance = per-context/
  -- knowledgebase; the instance boundary IS the story/context). partner + agent are a RESERVED
  -- forward-looking seam: the CHECK accepts them so policies can be authored ahead of reader
  -- wiring, but no enforcer reads them yet and nothing writes them, so they are INTENTIONALLY
  -- non-binding today — a recorded seam, NOT a fail-open hole. The scope-type-write-read-parity
  -- gate asserts every CHECK scope is either enforced (read by an enforcer fn) or reserved-here,
  -- so a FUTURE scope that is silently neither (a real fail-open) is caught at PR time.
  -- @scope-reserved: partner, agent
  scope_type        text NOT NULL
    CHECK (scope_type IN ('story', 'partner', 'agent')),
  scope_id          uuid NOT NULL,
  period            text NOT NULL DEFAULT 'lifetime'
    CHECK (period IN ('lifetime', 'daily', 'monthly')),
  token_limit       int
    CHECK (token_limit IS NULL OR token_limit >= 0),
  cost_limit    numeric(10,4)
    CHECK (cost_limit IS NULL OR cost_limit >= 0),
  consumed_tokens   int NOT NULL DEFAULT 0
    CHECK (consumed_tokens >= 0),
  consumed_cost numeric(10,4) NOT NULL DEFAULT 0
    CHECK (consumed_cost >= 0),
  last_reset_at     timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_budget_scope_period_uniq UNIQUE (scope_type, scope_id, period)
);

ALTER TABLE public.ai_budget ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.ai_budget IS
  'Mission Control — scope-generic AI spend cap (story|partner|agent × lifetime|daily|monthly). NULL limit = that dimension uncapped. Service-role mutations only via audited RPCs; checked at the orchestration control layer alongside per-user llm_quota.';
