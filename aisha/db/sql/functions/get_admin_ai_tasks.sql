-- Function: public.get_admin_ai_tasks
-- Arguments: p_status text DEFAULT NULL, p_limit int DEFAULT 50
-- Security: SECURITY DEFINER
-- Source: Phase 4 — Agent Loop & Memory

CREATE OR REPLACE FUNCTION public.get_admin_ai_tasks(p_status text DEFAULT NULL, p_limit int DEFAULT 50)
 RETURNS TABLE(task_id uuid, user_id uuid, task_type text, status text, progress int, current_step int, max_steps int, error_message text, run_id uuid, created_at timestamptz, started_at timestamptz, completed_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied: admin or staff required';
  END IF;

  RETURN QUERY
  SELECT t.id AS task_id, t.user_id, t.task_type, t.status, t.progress, t.current_step, t.max_steps,
         t.error_message, t.run_id, t.created_at, t.started_at, t.completed_at
  FROM ai_tasks t
  WHERE (p_status IS NULL OR t.status = p_status)
  ORDER BY t.created_at DESC
  LIMIT LEAST(p_limit, 200);
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_ai_tasks(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_ai_tasks(text, integer) TO authenticated;
