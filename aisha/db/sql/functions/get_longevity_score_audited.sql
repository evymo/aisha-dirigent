-- Function: public.get_longevity_score_audited
-- Description: Get Longevity Score for a specific questionnaire response
-- Security: SECURITY DEFINER with audit logging
-- sensitive data: Yes - reads questionnaire responses (health data)

CREATE OR REPLACE FUNCTION public.get_longevity_score_audited(
  p_response_id UUID
)
RETURNS longevity_score_result
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result longevity_score_result;
  v_responses JSONB;
  v_domain_scores JSONB;
  v_cls_score NUMERIC;
  v_valid_domains INTEGER := 0;
  v_domain JSONB;
  v_baseline_score NUMERIC;
  v_user_id UUID;
  v_questionnaire_id UUID;
BEGIN
  -- Get response data
  SELECT qr.id, qr.user_id, qr.completed_at, qr.responses, qr.questionnaire_id
  INTO v_result.response_id, v_user_id, v_result.completed_at, v_responses, v_questionnaire_id
  FROM questionnaire_responses qr
  WHERE qr.id = p_response_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Response not found';
  END IF;
  
  -- Authorization check
  IF NOT (
    v_user_id = auth.uid() OR
    is_admin_or_staff(auth.uid())
  ) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  
  v_result.user_id := v_user_id;
  
  -- Calculate domain scores
  v_domain_scores := calculate_domain_scores(v_responses);
  v_result.domain_scores := v_domain_scores;
  
  -- Calculate CLS (average of valid domain percentages)
  v_cls_score := 0;
  FOR v_domain IN SELECT * FROM jsonb_array_elements(v_domain_scores) LOOP
    IF (v_domain->>'percentage') IS NOT NULL THEN
      v_cls_score := v_cls_score + (v_domain->>'percentage')::NUMERIC;
      v_valid_domains := v_valid_domains + 1;
    END IF;
  END LOOP;
  
  IF v_valid_domains > 0 THEN
    v_result.cls_score := ROUND(v_cls_score / v_valid_domains, 1);
  ELSE
    v_result.cls_score := NULL;
  END IF;
  
  -- Get baseline score for trend calculation
  SELECT cls.cls_score INTO v_baseline_score
  FROM questionnaire_responses qr
  CROSS JOIN LATERAL (
    SELECT ROUND(
      (SELECT AVG((d->>'percentage')::NUMERIC) 
       FROM jsonb_array_elements(calculate_domain_scores(qr.responses)) d 
       WHERE (d->>'percentage') IS NOT NULL
      ), 1
    ) AS cls_score
  ) cls
  WHERE qr.user_id = v_user_id
    AND qr.questionnaire_id = v_questionnaire_id
    AND qr.completed_at < v_result.completed_at
  ORDER BY qr.completed_at ASC
  LIMIT 1;
  
  IF v_baseline_score IS NOT NULL AND v_result.cls_score IS NOT NULL THEN
    v_result.trend_vs_baseline := ROUND(v_result.cls_score - v_baseline_score, 1);
    v_result.trend_direction := CASE
      WHEN v_result.trend_vs_baseline > 2 THEN 'improving'
      WHEN v_result.trend_vs_baseline < -2 THEN 'declining'
      ELSE 'stable'
    END;
  ELSE
    v_result.trend_vs_baseline := NULL;
    v_result.trend_direction := NULL;
  END IF;
  
  -- Audit log
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'sensitive data_READ',
    jsonb_build_object(
      'area', 'longevity_score',
      'severity', 'info',
      'entity_type', 'questionnaire_response',
      'entity_id', p_response_id,
      'user_id', v_user_id
    )
  );
  
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_longevity_score_audited(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_longevity_score_audited(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_longevity_score_audited(uuid) IS 'Get Longevity Score (CLS) for a specific questionnaire response with audit logging';
