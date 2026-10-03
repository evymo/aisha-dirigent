-- Function: public.update_ai_task_progress
-- Arguments: p_task_id uuid, p_status text DEFAULT NULL, p_progress int DEFAULT NULL, p_current_step int DEFAULT NULL, p_result jsonb DEFAULT NULL, p_error_message text DEFAULT NULL
-- Security: SECURITY DEFINER
-- Source: Phase 4 — Agent Loop & Memory

CREATE OR REPLACE FUNCTION public.update_ai_task_progress(p_task_id uuid, p_status text DEFAULT NULL, p_progress int DEFAULT NULL, p_current_step int DEFAULT NULL, p_result jsonb DEFAULT NULL, p_error_message text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
BEGIN
  IF v_actor_id IS NOT NULL AND NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied: admin or staff required';
  END IF;

  UPDATE ai_tasks SET
    status        = COALESCE(p_status, status),
    progress      = COALESCE(p_progress, progress),
    current_step  = COALESCE(p_current_step, current_step),
    result        = COALESCE(p_result, result),
    error_message = COALESCE(p_error_message, error_message),
    started_at    = CASE WHEN p_status = 'running' AND started_at IS NULL THEN now() ELSE started_at END,
    completed_at  = CASE WHEN p_status IN ('done', 'failed', 'cancelled') THEN now() ELSE completed_at END,
    updated_at    = now()
  WHERE id = p_task_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_ai_task_progress(uuid, text, integer, integer, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_ai_task_progress(uuid, text, integer, integer, jsonb, text) TO authenticated;
