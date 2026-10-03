-- Function: public.get_my_ai_tasks
-- Arguments: p_limit int DEFAULT 20, p_status text DEFAULT NULL
-- Security: SECURITY DEFINER
-- Source: Phase 4 — Agent Loop & Memory

CREATE OR REPLACE FUNCTION public.get_my_ai_tasks(p_limit int DEFAULT 20, p_status text DEFAULT NULL)
 RETURNS TABLE(task_id uuid, task_type text, status text, progress int, created_at timestamptz, started_at timestamptz, completed_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
  SELECT t.id AS task_id, t.task_type, t.status, t.progress, t.created_at, t.started_at, t.completed_at
  FROM ai_tasks t
  WHERE t.user_id = auth.uid()
    AND (p_status IS NULL OR t.status = p_status)
  ORDER BY t.created_at DESC
  LIMIT LEAST(p_limit, 100);
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_ai_tasks(integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_ai_tasks(integer, text) TO authenticated;
