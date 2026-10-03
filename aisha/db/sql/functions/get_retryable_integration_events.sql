-- Function: public.get_retryable_integration_events
-- Returns failed integration events whose next_retry_at has passed.
-- Used by WF_RETRY_FAILED_EVENTS n8n workflow for exponential backoff retry.
-- @security: service_role only (called from n8n with service_role key)

CREATE OR REPLACE FUNCTION public.get_retryable_integration_events(
  p_limit integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', ie.id,
        'event_source', ie.event_source,
        'external_id', ie.external_id,
        'event_type', ie.event_type,
        'installation_id', ie.installation_id,
        'story_id', ie.story_id,
        'partner_id', ie.partner_id,
        'routed_to', ie.routed_to,
        'attempt', ie.attempt,
        'max_attempts', ie.max_attempts,
        'payload_hash', ie.payload_hash,
        'error_json', ie.error_json,
        'created_at', ie.created_at
      )
      ORDER BY ie.next_retry_at ASC
    ), '[]'::jsonb)
    FROM integration_events ie
    WHERE ie.status = 'failed'
      AND ie.next_retry_at IS NOT NULL
      AND ie.next_retry_at <= now()
      AND ie.attempt < ie.max_attempts
    LIMIT p_limit
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_retryable_integration_events(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_retryable_integration_events(integer) TO service_role;
