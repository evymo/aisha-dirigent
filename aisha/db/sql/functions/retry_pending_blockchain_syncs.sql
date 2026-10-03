-- Function: retry_pending_blockchain_syncs
-- Dispatcher RPC: picks queued/failed items ready for retry, marks as dispatched.
-- Called by blockchain-dispatch edge function.
-- Uses FOR UPDATE SKIP LOCKED for concurrent-safe consumption.
--
-- Returns: array of records to dispatch to RabbitMQ

CREATE OR REPLACE FUNCTION public.retry_pending_blockchain_syncs(
  p_batch_size integer DEFAULT 20
)
  RETURNS SETOF blockchain_audit_records
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
BEGIN
  -- Auth check: service_role only (called from blockchain-dispatch EF)
  IF public.get_jwt_role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  WITH batch AS (
    SELECT id
    FROM blockchain_audit_records
    WHERE status IN ('queued', 'failed')
      AND (next_retry_at IS NULL OR next_retry_at <= now())
      AND retry_count < max_attempts
    ORDER BY created_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE blockchain_audit_records bar
  SET
    status = 'dispatched',
    updated_at = now()
  FROM batch
  WHERE bar.id = batch.id
  RETURNING bar.*;
END;
$function$;

REVOKE ALL ON FUNCTION retry_pending_blockchain_syncs(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retry_pending_blockchain_syncs(integer) TO service_role;
