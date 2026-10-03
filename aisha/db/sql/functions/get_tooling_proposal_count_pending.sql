-- ============================================================================
-- Source of Truth: get_tooling_proposal_count_pending
-- Popis: StatBox helper — count pending tooling proposals.
-- Volá: dashboard StatBox widget
-- Auth: any authenticated
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_tooling_proposal_count_pending()
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
  FROM public.aisha_tooling_proposals
  WHERE approval_status = 'pending';

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.get_tooling_proposal_count_pending() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tooling_proposal_count_pending() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tooling_proposal_count_pending() TO service_role;
