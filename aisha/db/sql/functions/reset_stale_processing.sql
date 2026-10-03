-- Function: reset_stale_processing
-- Sweeper RPC: resets records stuck in 'processing' for > p_timeout_minutes.
-- Prevents consumer crashes from permanently locking records.
-- Should be called periodically (e.g. cron every 5 min).

CREATE OR REPLACE FUNCTION public.reset_stale_processing(
  p_timeout_minutes integer DEFAULT 5
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
  v_is_service_role boolean;
BEGIN
  -- Auth check: service_role or admin/staff (called from n8n cron or admin panel)
  v_is_service_role := COALESCE(
    public.get_jwt_role() = 'service_role',
    false
  );
  IF NOT v_is_service_role AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Service role or admin/staff required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  WITH stale AS (
    UPDATE blockchain_audit_records
    SET
      status = CASE
        WHEN retry_count >= max_attempts THEN 'exhausted'
        ELSE 'failed'
      END,
      error_message = 'Processing timeout after ' || p_timeout_minutes || ' minutes',
      next_retry_at = CASE
        WHEN retry_count >= max_attempts THEN NULL
        ELSE now() + (power(3, retry_count) * interval '1 minute')
      END,
      updated_at = now()
    WHERE status = 'processing'
      AND processing_started_at < now() - (p_timeout_minutes || ' minutes')::interval
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM stale;

  IF v_count > 0 THEN
    PERFORM public.write_audit_journal(
      p_action_type := 'update'::journal_action_type,
      p_area := 'blockchain'::journal_area,
      p_details := jsonb_build_object(
        'count', v_count,
        'timeout_minutes', p_timeout_minutes
      ),
      p_entity_type := 'blockchain_audit_records',
      p_severity := 'warning'::journal_severity,
      p_summary := 'Blockchain stale processing reset',
      p_user_id := auth.uid()
    );
  END IF;

  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION reset_stale_processing(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reset_stale_processing(integer) TO service_role;
GRANT EXECUTE ON FUNCTION reset_stale_processing(integer) TO authenticated;
