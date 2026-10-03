-- Function: public.get_ai_task_status
-- Arguments: p_task_id uuid
-- Security: SECURITY DEFINER
-- Source: Phase 4 — Agent Loop & Memory

CREATE OR REPLACE FUNCTION public.get_ai_task_status(p_task_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_task record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT t.id, t.task_type, t.status, t.progress, t.current_step, t.max_steps,
         t.result, t.error_message, t.started_at, t.completed_at, t.created_at
  INTO v_task
  FROM ai_tasks t
  WHERE t.id = p_task_id AND t.user_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found or access denied';
  END IF;

  RETURN jsonb_build_object(
    'task_id', v_task.id, 'task_type', v_task.task_type,
    'status', v_task.status, 'progress', v_task.progress,
    'current_step', v_task.current_step, 'max_steps', v_task.max_steps,
    'result', v_task.result, 'error_message', v_task.error_message,
    'started_at', v_task.started_at, 'completed_at', v_task.completed_at,
    'created_at', v_task.created_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_ai_task_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ai_task_status(uuid) TO authenticated;
