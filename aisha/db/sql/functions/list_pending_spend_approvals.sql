-- ============================================================================
-- Source of Truth: list_pending_spend_approvals
-- Purpose: Mission Control SpendApprovalPending pane — runs blocked at
--          admission with awaiting='spend_approval', newest first, with the
--          authorization payload (estimate, thresholds, reason) persisted in
--          run metadata at admission time.
-- Security: SECURITY DEFINER; admin/staff see all, others see runs on
--           stories they participate in (mirrors list_active_agent_runs).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.list_pending_spend_approvals(
  p_limit int DEFAULT 20
)
RETURNS TABLE (
  run_id          uuid,
  kind            text,
  story_id        uuid,
  story_title     text,
  requested_at    timestamptz,
  age_ms          bigint,
  estimate    numeric,
  decision_reason text,
  authorization_json jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id  uuid    := auth.uid();
  v_is_admin boolean := false;
BEGIN
  IF v_user_id IS NULL
     AND (current_setting('request.jwt.claims', true)::jsonb->>'role') <> 'service_role'
  THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  v_is_admin := public.is_admin_or_staff(v_user_id);

  RETURN QUERY
  SELECT
    ar.id                                                       AS run_id,
    ar.kind,
    ar.story_id,
    ps.title                                                    AS story_title,
    ar.started_at                                               AS requested_at,
    EXTRACT(EPOCH FROM (now() - ar.started_at))::bigint * 1000  AS age_ms,
    NULLIF(ar.metadata->'spend_authorization'->>'estimate_used', '')::numeric
                                                                AS estimate,
    ar.metadata->'spend_authorization'->>'reason'               AS decision_reason,
    ar.metadata->'spend_authorization'                          AS authorization_json
  FROM public.ai_runs ar
  LEFT JOIN public.partner_stories ps ON ps.id = ar.story_id
  WHERE ar.status = 'blocked'
    AND ar.metadata->>'awaiting' = 'spend_approval'
    AND (
      v_is_admin
      OR EXISTS (
        SELECT 1 FROM public.story_participants sp
        WHERE sp.story_id = ar.story_id AND sp.user_id = v_user_id
      )
    )
  ORDER BY ar.started_at DESC
  LIMIT LEAST(p_limit, 100);
END;
$$;

REVOKE ALL ON FUNCTION public.list_pending_spend_approvals(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_pending_spend_approvals(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_pending_spend_approvals(int) TO service_role;

COMMENT ON FUNCTION public.list_pending_spend_approvals(int) IS
  'Runs blocked awaiting spend approval, with admission-time authorization payload, for the Mission Control SpendApprovalPending pane.';
