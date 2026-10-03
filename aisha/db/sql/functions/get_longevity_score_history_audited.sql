-- Function: public.get_longevity_score_history_audited
-- Description: Get Longevity Score history for a user
-- Security: SECURITY DEFINER with audit logging
-- sensitive data: Yes - reads questionnaire responses history

CREATE OR REPLACE FUNCTION public.get_longevity_score_history_audited(
  p_user_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 12
)
RETURNS TABLE (
  response_id UUID,
  completed_at TIMESTAMPTZ,
  cls_score NUMERIC,
  domain_scores JSONB,
  trend_vs_previous NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_target_user UUID;
  v_questionnaire_id UUID;
BEGIN
  -- Determine target user
  v_target_user := COALESCE(p_user_id, auth.uid());
  
  -- Authorization check
  IF NOT (
    v_target_user = auth.uid() OR
    is_admin_or_staff(auth.uid()) OR
    has_data_sharing_consent(v_target_user, auth.uid())
  ) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  
  -- Get OS-SUBJECTIVE questionnaire ID
  SELECT id INTO v_questionnaire_id
  FROM questionnaires
  WHERE code = 'OS-SUBJECTIVE';
  
  -- Audit log
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'sensitive data_READ',
    jsonb_build_object(
      'area', 'longevity_score',
      'severity', 'info',
      'entity_type', 'history',
      'user_id', v_target_user,
      'limit', p_limit
    )
  );
  
  -- Return history with calculated scores
  RETURN QUERY
  WITH scored_responses AS (
    SELECT 
      qr.id AS response_id,
      qr.completed_at,
      calculate_domain_scores(qr.responses) AS domain_scores
    FROM questionnaire_responses qr
    WHERE qr.user_id = v_target_user
      AND qr.questionnaire_id = v_questionnaire_id
      AND qr.completed_at IS NOT NULL
    ORDER BY qr.completed_at DESC
    LIMIT p_limit
  ),
  with_cls AS (
    SELECT 
      sr.response_id,
      sr.completed_at,
      sr.domain_scores,
      ROUND((
        SELECT AVG((d->>'percentage')::NUMERIC) 
        FROM jsonb_array_elements(sr.domain_scores) d 
        WHERE (d->>'percentage') IS NOT NULL
      ), 1) AS cls_score
    FROM scored_responses sr
  ),
  with_trend AS (
    SELECT 
      wc.*,
      wc.cls_score - LAG(wc.cls_score) OVER (ORDER BY wc.completed_at) AS trend_vs_previous
    FROM with_cls wc
  )
  SELECT 
    wt.response_id,
    wt.completed_at,
    wt.cls_score,
    wt.domain_scores,
    ROUND(wt.trend_vs_previous, 1)
  FROM with_trend wt
  ORDER BY wt.completed_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_longevity_score_history_audited(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_longevity_score_history_audited(uuid, integer) TO authenticated;

COMMENT ON FUNCTION public.get_longevity_score_history_audited(uuid, integer) IS 'Get Longevity Score history with trend calculation';
