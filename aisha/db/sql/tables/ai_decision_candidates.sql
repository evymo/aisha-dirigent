-- ============================================================================
-- Source of Truth: ai_decision_candidates  (E0 decision lens — per-candidate ranking)
-- Purpose: The resolver already RETURNS a full per-candidate score breakdown + reasoning on every
--          decision, and fn_record_execution_decision stores it inside ai_decisions.decision_json
--          — but as an opaque blob. This normalizes that blob into queryable rows so an operator
--          can answer "why did candidate X score 0.73 / why was Y the winner" without hand-parsing
--          JSON. One row per candidate considered for a decision; written ONLY by
--          fn_record_execution_decision (alongside the ai_decisions row), forward-only.
-- Security: RLS inherits the parent decision's story scope (admin/staff read all).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ai_decision_candidates (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id   uuid        NOT NULL REFERENCES public.ai_decisions(id) ON DELETE CASCADE,
  rank          integer     NOT NULL,                 -- 1 = top (highest score)
  is_top        boolean     NOT NULL DEFAULT false,
  provider_slug text,
  model_id      text,
  backend_kind  text,
  score         numeric(8,4),
  -- The resolver's transparent breakdown string: 'bench=.. local_bonus=.. cost_match=.. ..'
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ai_decision_candidates IS
  'Per-candidate ranking for an ai_decisions row (the resolver score breakdown, normalized from decision_json). Written only by fn_record_execution_decision. Lets the admin drilldown show WHY a model won.';

-- Index lives in aisha/db/sql/indexes/idx_ai_decision_candidates_decision.sql (SoT separation).
-- RLS lives in aisha/db/sql/rls/ai_decision_candidates.sql (emitted after functions).

ALTER TABLE public.ai_decision_candidates ENABLE ROW LEVEL SECURITY;
