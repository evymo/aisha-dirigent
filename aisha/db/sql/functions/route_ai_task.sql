-- route_ai_task: Route an AI task to the appropriate agent pipeline
-- Called by: sentry-monitor/index.ts for incident analysis
CREATE OR REPLACE FUNCTION public.route_ai_task(
  p_task_kind text,
  p_prompt text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
  v_agents text[];
BEGIN
  -- Route based on task_kind → agent pipeline
  v_agents := CASE p_task_kind
    WHEN 'incident' THEN ARRAY['debug_agent', 'dev_patch']
    WHEN 'pr_gate' THEN ARRAY['compliance_gate']
    WHEN 'chat' THEN ARRAY['librarian']
    WHEN 'doc_update' THEN ARRAY['librarian']
    ELSE ARRAY['aisha_planner', 'dev_patch', 'compliance_gate', 'verifier']
  END;

  -- Log the routing decision
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'AI_TASK_ROUTED',
    jsonb_build_object(
      'area', 'ai',
      'severity', 'info',
      'task_kind', p_task_kind,
      'agents', to_jsonb(v_agents)
    )
  );

  v_result := jsonb_build_object(
    'task_kind', p_task_kind,
    'agents', to_jsonb(v_agents),
    'prompt', p_prompt,
    'metadata', p_metadata,
    'routed_at', now()
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.route_ai_task(text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.route_ai_task(text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.route_ai_task(text, text, jsonb) TO authenticated;
