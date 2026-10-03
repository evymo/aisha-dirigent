-- Function: public.create_ai_task
-- Arguments: p_task_type text, p_input jsonb DEFAULT '{}'::jsonb
-- Security: SECURITY DEFINER
-- Source: Phase 4 — Agent Loop & Memory

CREATE OR REPLACE FUNCTION public.create_ai_task(p_task_type text, p_input jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_task_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO ai_tasks (user_id, task_type, input)
  VALUES (auth.uid(), p_task_type, p_input)
  RETURNING id INTO v_task_id;

  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (auth.uid(), 'AI_TASK_CREATED', jsonb_build_object(
    'area', 'ai', 'severity', 'info',
    'task_id', v_task_id::text, 'task_type', p_task_type
  ));

  RETURN jsonb_build_object('task_id', v_task_id, 'status', 'queued');
END;
$$;

REVOKE ALL ON FUNCTION public.create_ai_task(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_ai_task(text, jsonb) TO authenticated;
