-- Function: public.submit_longevity_assessment_audited
-- Description: Submit OS-SUBJECTIVE questionnaire and calculate Longevity Score
-- Security: SECURITY DEFINER with audit logging
-- sensitive data: Yes - writes questionnaire responses

CREATE OR REPLACE FUNCTION public.submit_longevity_assessment_audited(
  p_responses JSONB,
  p_study_registration_id UUID DEFAULT NULL
)
RETURNS longevity_score_result
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_questionnaire_id UUID;
  v_response_id UUID;
  v_domain_scores JSONB;
  v_cls_score NUMERIC;
  v_valid_domains INTEGER := 0;
  v_domain JSONB;
  v_result longevity_score_result;
BEGIN
  -- Get OS-SUBJECTIVE questionnaire ID
  SELECT id INTO v_questionnaire_id
  FROM questionnaires
  WHERE code = 'OS-SUBJECTIVE';
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OS-SUBJECTIVE questionnaire not found';
  END IF;
  
  -- Calculate scores
  v_domain_scores := calculate_domain_scores(p_responses);
  
  -- Calculate CLS
  FOR v_domain IN SELECT * FROM jsonb_array_elements(v_domain_scores) LOOP
    IF (v_domain->>'percentage') IS NOT NULL THEN
      v_cls_score := COALESCE(v_cls_score, 0) + (v_domain->>'percentage')::NUMERIC;
      v_valid_domains := v_valid_domains + 1;
    END IF;
  END LOOP;
  
  IF v_valid_domains > 0 THEN
    v_cls_score := ROUND(v_cls_score / v_valid_domains, 1);
  END IF;
  
  -- Insert response
  INSERT INTO questionnaire_responses (
    user_id,
    questionnaire_id,
    responses,
    score,
    completed_at,
    study_registration_id
  )
  VALUES (
    auth.uid(),
    v_questionnaire_id,
    p_responses,
    ROUND(v_cls_score)::INTEGER,
    NOW(),
    p_study_registration_id
  )
  RETURNING id INTO v_response_id;
  
  -- Build result
  v_result.response_id := v_response_id;
  v_result.user_id := auth.uid();
  v_result.completed_at := NOW();
  v_result.cls_score := v_cls_score;
  v_result.domain_scores := v_domain_scores;
  
  -- Audit log
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'sensitive data_WRITE',
    jsonb_build_object(
      'area', 'longevity_score',
      'severity', 'info',
      'entity_type', 'questionnaire_response',
      'entity_id', v_response_id,
      'cls_score', v_cls_score,
      'study_registration_id', p_study_registration_id
    )
  );
  
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_longevity_assessment_audited(jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_longevity_assessment_audited(jsonb, uuid) TO authenticated;

COMMENT ON FUNCTION public.submit_longevity_assessment_audited(jsonb, uuid) IS 'Submit OS-SUBJECTIVE assessment and calculate Longevity Score';
