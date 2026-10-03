-- Function: assess_code_quality

CREATE OR REPLACE FUNCTION public.assess_code_quality(p_session_id uuid, p_file_paths text[], p_check_types text[] DEFAULT ARRAY['consistency'::text, 'rpc_only'::text, 'i18n'::text, 'no_any'::text, 'no_console'::text])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_session RECORD;
  v_findings jsonb := '[]'::jsonb;
  v_refactor_candidates jsonb := '[]'::jsonb;
  v_quality_rules jsonb;
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

  -- Load quality + compliance rules
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'slug', er.slug,
      'title', er.title,
      'category', er.category,
      'ai_instructions', er.ai_instructions
    )
  ), '[]'::jsonb)
  INTO v_quality_rules
  FROM expert_rules er
  WHERE er.status = 'published'
    AND er.category IN ('quality', 'compliance', 'security', 'patterns')
  LIMIT 25;

  -- Build check-type-specific findings structure
  -- (AI agent will populate actual findings via follow-up code analysis)
  IF 'rpc_only' = ANY(p_check_types) THEN
    v_findings := v_findings || jsonb_build_array(
      jsonb_build_object(
        'check', 'rpc_only',
        'description', 'Verify no direct .from() queries on sensitive tables',
        'status', 'pending'
      )
    );
  END IF;

  IF 'i18n' = ANY(p_check_types) THEN
    v_findings := v_findings || jsonb_build_array(
      jsonb_build_object(
        'check', 'i18n',
        'description', 'No hardcoded strings in JSX, no defaultValue fallbacks',
        'status', 'pending'
      )
    );
  END IF;

  IF 'no_any' = ANY(p_check_types) THEN
    v_findings := v_findings || jsonb_build_array(
      jsonb_build_object(
        'check', 'no_any',
        'description', 'No any types — use proper types or unknown + type guard',
        'status', 'pending'
      )
    );
  END IF;

  IF 'no_console' = ANY(p_check_types) THEN
    v_findings := v_findings || jsonb_build_array(
      jsonb_build_object(
        'check', 'no_console',
        'description', 'No console.log() — use safeError() for error logging',
        'status', 'pending'
      )
    );
  END IF;

  IF 'consistency' = ANY(p_check_types) THEN
    v_findings := v_findings || jsonb_build_array(
      jsonb_build_object(
        'check', 'consistency',
        'description', 'Naming conventions, file structure, export patterns',
        'status', 'pending'
      )
    );
  END IF;

  -- Record decision
  INSERT INTO moderation_decisions (session_id, decision_type, severity, context, recommendation, evidence)
  VALUES (
    p_session_id, 'quality_issue', 'info',
    jsonb_build_object('file_paths', to_jsonb(p_file_paths), 'check_types', to_jsonb(p_check_types)),
    'Code quality assessment for ' || array_length(p_file_paths, 1) || ' file(s)',
    jsonb_build_object('rules', v_quality_rules)
  )
  RETURNING id INTO v_decision_id;

  RETURN jsonb_build_object(
    'decision_id', v_decision_id,
    'findings', v_findings,
    'refactor_candidates', v_refactor_candidates,
    'consistency_score', NULL,
    'quality_rules', v_quality_rules,
    'check_types_applied', p_check_types
  );
END;
$function$;

REVOKE ALL ON FUNCTION assess_code_quality(uuid, text[], text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assess_code_quality(uuid,text[],text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION assess_code_quality(uuid,text[],text[]) TO service_role;
