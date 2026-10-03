-- View: public.selfeval_story_verdict_v
-- Self-evaluation LENS — per-story operational dimension aggregates (30d rolling).
-- Reads ONLY reused signals (faithfulness/drift/incidents/goal/proposals). The
-- composite score + level is composed by evaluate_story_self() RPC via
-- get_story_aisha_maturity(). "Evaluation je perspektiva, ne entita" — vzor
-- audience_actor_aggregate_latest_v. NO new table (viz SELF_EVAL_REUSE_VERIFICATION.md).
--
-- Story↔app correlation: drift_state / sentry_issue_snapshot link to a story via
-- coolify_app_slots.app_name → coolify_app_slots.story_id.
-- @security: granted to service_role only; authenticated reach is via the
-- SECURITY DEFINER evaluate_story_self() RPC (visibility-gated).

CREATE OR REPLACE VIEW public.selfeval_story_verdict_v AS
SELECT
  s.id AS story_id,
  -- faithfulness dimension (ai_runs.faithfulness_score_estimate)
  (SELECT ROUND(AVG(ar.faithfulness_score_estimate), 4)
     FROM public.ai_runs ar
    WHERE ar.story_id = s.id
      AND ar.faithfulness_score_estimate IS NOT NULL
      AND ar.started_at > now() - interval '30 days')          AS faithfulness_avg,
  (SELECT COUNT(*)
     FROM public.ai_runs ar
    WHERE ar.story_id = s.id
      AND ar.faithfulness_score_estimate IS NOT NULL
      AND ar.started_at > now() - interval '30 days')          AS faithfulness_n,
  -- drift dimension (drift_state via coolify_app_slots.story_id)
  (SELECT COUNT(*)
     FROM public.drift_state d
     JOIN public.coolify_app_slots c ON c.app_name = d.app_name
    WHERE c.story_id = s.id AND d.resolved_at IS NULL)          AS open_drift_count,
  (SELECT COUNT(*)
     FROM public.drift_state d
     JOIN public.coolify_app_slots c ON c.app_name = d.app_name
    WHERE c.story_id = s.id AND d.resolved_at IS NULL
      AND d.risk_level IN ('high','critical'))                 AS open_drift_high,
  -- incidents dimension (sentry_issue_snapshot via coolify_app_slots.story_id)
  (SELECT COALESCE(SUM(se.count), 0)
     FROM public.sentry_issue_snapshot se
     JOIN public.coolify_app_slots c ON c.app_name = se.app_name
    WHERE c.story_id = s.id AND se.level = 'fatal'
      AND se.observed_at > now() - interval '30 days')          AS sentry_fatal_30d,
  -- goal dimension (story_goal_state — autonomous loop acceptance criteria)
  g.acceptance_criteria,
  g.loop_iterations,
  g.loop_max,
  -- proposals (improvement_proposals correlated via run_id→ai_runs.story_id or metadata.story_id)
  (SELECT COUNT(*)
     FROM public.improvement_proposals ip
     LEFT JOIN public.ai_runs ar2 ON ar2.id = ip.run_id
    WHERE (ar2.story_id = s.id OR ip.metadata->>'story_id' = s.id::text)
      AND ip.status NOT IN ('applied','rejected','rolled_back')) AS open_proposals,
  (SELECT COUNT(*)
     FROM public.improvement_proposals ip
     LEFT JOIN public.ai_runs ar3 ON ar3.id = ip.run_id
    WHERE (ar3.story_id = s.id OR ip.metadata->>'story_id' = s.id::text)
      AND ip.applied_at IS NOT NULL
      AND ip.applied_at > now() - interval '30 days')           AS applied_proposals_30d
FROM public.partner_stories s
LEFT JOIN public.story_goal_state g ON g.story_id = s.id;

-- Least-privilege: direct reads only for service_role; authenticated reaches the
-- verdict through evaluate_story_self() (SECURITY DEFINER, visibility-gated).
REVOKE ALL ON public.selfeval_story_verdict_v FROM PUBLIC;
GRANT SELECT ON public.selfeval_story_verdict_v TO service_role;
