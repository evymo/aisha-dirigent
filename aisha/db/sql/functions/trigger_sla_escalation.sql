-- =============================================================================
-- trigger_sla_escalation
-- =============================================================================
-- Mark SLA as breached and record escalation time.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.trigger_sla_escalation(
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
  SET sla_breached = true,
      escalated_at = now()
  WHERE id = p_sla_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.trigger_sla_escalation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trigger_sla_escalation(uuid) TO authenticated;
