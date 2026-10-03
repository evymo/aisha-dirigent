-- Function: estimate_effort

CREATE OR REPLACE FUNCTION public.estimate_effort(p_session_id uuid, p_task_description text, p_affected_files text[], p_complexity_factors jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_session RECORD;
  v_breakdown jsonb := '[]'::jsonb;
  v_risks jsonb := '[]'::jsonb;
  v_file_count int;
  v_base_hours numeric;
  v_confidence text;
  v_decision_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Verify session ownership
  SELECT * INTO v_session
  FROM moderation_sessions ms
  WHERE ms.id = p_session_id AND (ms.user_id = v_user_id OR is_admin_or_staff());

  IF v_session IS NULL THEN
    RAISE EXCEPTION 'Session not found or access denied' USING ERRCODE = 'P0002';
  END IF;

  -- Basic effort heuristic based on file count and complexity
  v_file_count := COALESCE(array_length(p_affected_files, 1), 0);

  -- Base estimate: ~1h per file, adjusted by session expertise
  v_base_hours := GREATEST(0.5, v_file_count * 1.0);

  -- Adjust by expertise level (beginners take ~2x longer)
  v_base_hours := v_base_hours * CASE v_session.expertise_level
    WHEN 'beginner' THEN 2.0
    WHEN 'intermediate' THEN 1.5
    WHEN 'advanced' THEN 1.0
    WHEN 'expert' THEN 0.8
  END;

  -- Adjust by complexity factors
  IF (p_complexity_factors->>'has_migration')::boolean IS TRUE THEN
    v_base_hours := v_base_hours + 1.5;
    v_breakdown := v_breakdown || jsonb_build_array(
      jsonb_build_object('item', 'Database migration', 'hours', 1.5)
    );
  END IF;

  IF (p_complexity_factors->>'has_rpc')::boolean IS TRUE THEN
    v_base_hours := v_base_hours + 1.0;
    v_breakdown := v_breakdown || jsonb_build_array(
      jsonb_build_object('item', 'RPC function implementation', 'hours', 1.0)
    );
  END IF;

  IF (p_complexity_factors->>'has_tests')::boolean IS TRUE THEN
    v_base_hours := v_base_hours + v_file_count * 0.5;
    v_breakdown := v_breakdown || jsonb_build_array(
      jsonb_build_object('item', 'Test implementation', 'hours', v_file_count * 0.5)
    );
  END IF;

  -- Confidence based on info completeness
  v_confidence := CASE
    WHEN v_file_count > 0 AND p_task_description IS NOT NULL AND p_complexity_factors != '{}'::jsonb THEN 'high'
    WHEN v_file_count > 0 OR p_task_description IS NOT NULL THEN 'medium'
    ELSE 'low'
  END;

  -- Risk assessment
  IF v_file_count > 10 THEN
    v_risks := v_risks || jsonb_build_array(
      jsonb_build_object('risk', 'Large changeset', 'impact', 'high', 'mitigation', 'Consider splitting into smaller PRs')
    );
  END IF;

  -- Add file work to breakdown
  IF v_file_count > 0 THEN
    v_breakdown := jsonb_build_array(
      jsonb_build_object('item', 'Code changes (' || v_file_count || ' files)', 'hours', v_file_count * 1.0)
    ) || v_breakdown;
  END IF;

  -- Record decision
  INSERT INTO moderation_decisions (session_id, decision_type, severity, context, recommendation, evidence)
  VALUES (
    p_session_id, 'estimation_adjustment', 'info',
    jsonb_build_object(
      'task', p_task_description,
      'files', to_jsonb(p_affected_files),
      'complexity', p_complexity_factors
    ),
    'Effort estimate: ~' || round(v_base_hours, 1) || ' hours (' || v_confidence || ' confidence)',
    jsonb_build_object('breakdown', v_breakdown, 'risks', v_risks)
  )
  RETURNING id INTO v_decision_id;

  RETURN jsonb_build_object(
    'decision_id', v_decision_id,
    'estimate_hours', round(v_base_hours, 1),
    'confidence', v_confidence,
    'breakdown', v_breakdown,
    'risks', v_risks,
    'expertise_factor', v_session.expertise_level
  );
END;
$function$;

REVOKE ALL ON FUNCTION estimate_effort(uuid, text, text[], jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION estimate_effort(uuid,text,text[],jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION estimate_effort(uuid,text,text[],jsonb) TO service_role;
