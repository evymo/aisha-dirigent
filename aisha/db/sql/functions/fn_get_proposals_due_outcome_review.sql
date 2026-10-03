-- Function: public.fn_get_proposals_due_outcome_review
-- Lists APPLIED improvement_proposals that need an outcome-review step driven by
-- WF_PROPOSAL_OUTCOME_REVIEW (cron). Returns the next phase per proposal:
--   'baseline' — no score_before yet (capture asap after apply)
--   'outcome'  — baseline set + window elapsed (capture delta)
-- Already-finalized proposals (outcome.measured_at set) are excluded.
--
-- @security: service_role only (cron-internal; improvement_proposals are admin data).

CREATE OR REPLACE FUNCTION public.fn_get_proposals_due_outcome_review(
  p_window_hours int DEFAULT 24,
  p_limit        int DEFAULT 50
)
RETURNS TABLE (
  proposal_id uuid,
  agent_slug  text,
  applied_at  timestamptz,
  phase       text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    ip.id,
    ip.agent_slug,
    ip.applied_at,
    CASE WHEN (ip.outcome->>'score_before') IS NULL THEN 'baseline' ELSE 'outcome' END AS phase
  FROM public.improvement_proposals ip
  WHERE ip.status = 'applied'
    AND (ip.outcome->>'measured_at') IS NULL
    AND (
      (ip.outcome->>'score_before') IS NULL
      OR ip.applied_at < now() - (p_window_hours || ' hours')::interval
    )
  ORDER BY ip.applied_at ASC NULLS LAST
  LIMIT GREATEST(1, LEAST(p_limit, 200));
$$;

REVOKE ALL ON FUNCTION public.fn_get_proposals_due_outcome_review(int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_proposals_due_outcome_review(int, int) TO service_role;
