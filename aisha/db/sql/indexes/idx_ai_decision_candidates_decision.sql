-- Index: ai_decision_candidates lookup by parent decision (drilldown + RLS chain).
CREATE INDEX IF NOT EXISTS idx_ai_decision_candidates_decision
  ON public.ai_decision_candidates (decision_id, rank);
