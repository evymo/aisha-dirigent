-- Function: public.cancel_ai_task
-- Arguments: p_task_id uuid
-- Security: SECURITY DEFINER
-- Source: Phase 4 — Agent Loop & Memory

CREATE OR REPLACE FUNCTION public.cancel_ai_task(p_task_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_updated boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE ai_tasks
  SET status = 'cancelled', completed_at = now(), updated_at = now()
  WHERE id = p_task_id AND user_id = auth.uid() AND status IN ('queued', 'running');

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_ai_task(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_ai_task(uuid) TO authenticated;
