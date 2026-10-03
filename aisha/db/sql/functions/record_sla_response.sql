-- =============================================================================
-- record_sla_response
-- =============================================================================
-- Record first response time for SLA tracking.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.record_sla_response(
  p_sla_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE sla_tracking
  SET first_response_at = now()
  WHERE id = p_sla_id
    AND first_response_at IS NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_sla_response(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_sla_response(uuid) TO authenticated;
