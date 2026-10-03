-- ============================================================================
-- Source of Truth: get_pending_rollback_count
-- Popis: StatBox helper — count pending rollback approvals.
-- Auth: any authenticated
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_pending_rollback_count()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
DECLARE
  v_count int := 0;
  v_caller uuid;
BEGIN
  -- Auth check: require authenticated user OR service_role
  v_caller := auth.uid();
  IF v_caller IS NULL
     AND (current_setting('request.jwt.claims', true)::jsonb->>'role') <> 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: authentication required';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.rollback_history
  WHERE approval_status = 'pending';

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.get_pending_rollback_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pending_rollback_count() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pending_rollback_count() TO service_role;
