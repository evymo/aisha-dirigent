-- Function: public.get_agent_run
-- Description: Fetch full details of a single agent run by ID.
--   Accessible to the requesting user and service_role.
-- Security: SECURITY DEFINER, grants to authenticated + service_role

-- Return shape gained the structured `outputs` + the admission/approval columns
-- (approval_required / approved_at / awaiting) — DROP the prior shape so the new
-- RETURNS TABLE replaces it (a column-set change is not a CREATE OR REPLACE).
DROP FUNCTION IF EXISTS public.get_agent_run(uuid);

CREATE OR REPLACE FUNCTION public.get_agent_run(p_run_id uuid)
RETURNS TABLE (
  id                uuid,
  kind              text,
  profile           text,
  status            text,
  source            text,
  source_ref        text,
  outputs_s3_uri    text,
  outputs           jsonb,
  exit_code         integer,
  error_summary     text,
  approval_required boolean,
  approved_at       timestamptz,
  awaiting          text,
  started_at        timestamptz,
  finished_at       timestamptz,
  created_at        timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id, r.kind, r.profile, r.status, r.source, r.source_ref,
    r.outputs_s3_uri, r.outputs, r.exit_code, r.error_summary,
    r.approval_required, r.approved_at, r.awaiting,
    r.started_at, r.finished_at, r.created_at
  FROM public.agent_runs r
  WHERE r.id = p_run_id
    AND (r.requested_by = auth.uid() OR auth.jwt() ->> 'role' = 'service_role');
END;
$$;

REVOKE ALL ON FUNCTION public.get_agent_run(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_agent_run(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_agent_run(uuid) TO service_role;
