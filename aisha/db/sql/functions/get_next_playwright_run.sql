-- get_next_playwright_run
-- Runner container polls this — returns at most one queued run that is
-- either auto-trigger OR has been approved. Service-role only.

CREATE OR REPLACE FUNCTION public.get_next_playwright_run()
RETURNS TABLE (
  id uuid,
  trigger_kind public.playwright_run_trigger,
  target_env text,
  target_base_url text,
  suite text,
  deploy_ref text,
  metadata jsonb,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_service boolean;
BEGIN
  v_is_service := public.is_service_role();
  IF NOT v_is_service THEN
    RAISE EXCEPTION 'Unauthorized: service_role required';
  END IF;

  RETURN QUERY
  SELECT pr.id, pr.trigger_kind, pr.target_env, pr.target_base_url, pr.suite,
         pr.deploy_ref, pr.metadata, pr.created_at
  FROM public.playwright_runs pr
  WHERE pr.status = 'queued'
    AND (pr.approval_required = false OR pr.approved_at IS NOT NULL)
  ORDER BY pr.created_at ASC
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_next_playwright_run() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_next_playwright_run() TO service_role;
