-- Function: evaluate_test_strategy

CREATE OR REPLACE FUNCTION public.evaluate_test_strategy(p_session_id uuid, p_hook_name text, p_file_path text, p_test_file_path text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_session RECORD;
  v_chain jsonb := '[]'::jsonb;
  v_gaps jsonb := '[]'::jsonb;
  v_recommendations jsonb := '[]'::jsonb;
  v_test_rules jsonb;
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

  -- Load testing rules
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'slug', er.slug,
      'title', er.title,
      'ai_instructions', er.ai_instructions
    )
  ), '[]'::jsonb)
  INTO v_test_rules
  FROM expert_rules er
  WHERE er.status = 'published'
    AND public.expert_rule_visible_to(er.visibility, er.author_partner_id, v_user_id)
    AND er.category IN ('testing', 'quality')
  LIMIT 15;

  -- Build test chain (what tests should exist)
  v_chain := jsonb_build_array(
    jsonb_build_object('step', 'unit', 'description', 'Unit tests for ' || p_hook_name, 'required', true),
    jsonb_build_object('step', 'mock_validation', 'description', 'Mock matches implementation pattern', 'required', true),
    jsonb_build_object('step', 'error_handling', 'description', 'Error cases covered', 'required', true),
    jsonb_build_object('step', 'edge_cases', 'description', 'Edge cases and boundary conditions', 'required', false)
  );

  -- Identify gaps (AI will refine these based on actual code analysis)
  IF p_test_file_path IS NULL THEN
    v_gaps := jsonb_build_array(
      jsonb_build_object(
        'type', 'missing_test_file',
        'description', 'No test file found for ' || p_hook_name,
        'severity', 'error'
      )
    );
  END IF;

  -- Build recommendations
  v_recommendations := jsonb_build_array(
    jsonb_build_object(
      'type', 'mock_pattern',
      'description', 'Verify mock matches actual RPC calls (rpc-only pattern)',
      'priority', 'high'
    ),
    jsonb_build_object(
      'type', 'vi_mocked',
      'description', 'Use vi.mocked() consistently, avoid double tracking',
      'priority', 'medium'
    )
  );

  -- Record decision
  INSERT INTO moderation_decisions (session_id, decision_type, severity, context, recommendation, evidence)
  VALUES (
    p_session_id, 'test_gap',
    CASE WHEN p_test_file_path IS NULL THEN 'error' ELSE 'info' END,
    jsonb_build_object('hook_name', p_hook_name, 'file_path', p_file_path, 'test_file_path', p_test_file_path),
    'Evaluate test strategy for ' || p_hook_name,
    jsonb_build_object('rules', v_test_rules)
  )
  RETURNING id INTO v_decision_id;

  RETURN jsonb_build_object(
    'decision_id', v_decision_id,
    'chain', v_chain,
    'gaps', v_gaps,
    'recommendations', v_recommendations,
    'test_rules', v_test_rules
  );
END;
$function$;

REVOKE ALL ON FUNCTION evaluate_test_strategy(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION evaluate_test_strategy(uuid,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION evaluate_test_strategy(uuid,text,text,text) TO service_role;
