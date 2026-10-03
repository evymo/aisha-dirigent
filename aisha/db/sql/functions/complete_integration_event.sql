-- Function: public.complete_integration_event
-- Marks an integration event as completed/failed with optional retry scheduling.
-- Retry uses exponential backoff: 5^attempt minutes (5m, 25m, 125m).
-- @security: service_role only

CREATE OR REPLACE FUNCTION public.complete_integration_event(
  p_event_id         uuid,
  p_status           text,
  p_n8n_execution_id text DEFAULT NULL,
  p_error_json       jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE integration_events
  SET
    status = p_status,
    processing_finished_at = now(),
    n8n_execution_id = COALESCE(p_n8n_execution_id, n8n_execution_id),
    error_json = COALESCE(p_error_json, error_json),
    attempt = CASE WHEN p_status = 'failed' THEN attempt + 1 ELSE attempt END,
    next_retry_at = CASE
      WHEN p_status = 'failed' AND attempt < max_attempts
      THEN now() + (POWER(5, attempt) || ' minutes')::interval
      ELSE NULL
    END
  WHERE id = p_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_integration_event(uuid, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_integration_event(uuid, text, text, jsonb) TO service_role;
