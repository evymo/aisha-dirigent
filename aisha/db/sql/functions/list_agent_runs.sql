-- Function: public.list_agent_runs
-- Description: Paginated list of the caller's agent runs, newest first.
--   Max 100 rows per call; service_role sees all via RLS policy.
-- Security: SECURITY DEFINER, grants to authenticated

CREATE OR REPLACE FUNCTION public.list_agent_runs(
  p_limit  int DEFAULT 20,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  id           uuid,
  kind         text,
  status       text,
  source       text,
  source_ref   text,
  started_at   timestamptz,
  finished_at  timestamptz,
  created_at   timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT r.id, r.kind, r.status, r.source, r.source_ref,
         r.started_at, r.finished_at, r.created_at
  FROM public.agent_runs r
  WHERE r.requested_by = auth.uid()
  ORDER BY r.created_at DESC
  LIMIT LEAST(p_limit, 100) OFFSET p_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.list_agent_runs(int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_agent_runs(int, int) TO authenticated;
