-- Function: public.record_integration_event
-- Idempotent upsert for incoming integration events (webhooks, deployments, etc.)
-- Deduplicates by (event_source, external_id) UNIQUE constraint.
-- @security: service_role only

CREATE OR REPLACE FUNCTION public.record_integration_event(
  p_event_source    text,
  p_external_id     text,
  p_event_type      text,
  p_installation_id bigint DEFAULT NULL,
  p_story_id        uuid DEFAULT NULL,
  p_partner_id      uuid DEFAULT NULL,
  p_routed_to       text DEFAULT NULL,
  p_payload_hash    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_event_id uuid;
  v_is_duplicate boolean := false;
BEGIN
  INSERT INTO integration_events (
    event_source, external_id, event_type,
    installation_id, story_id, partner_id,
    routed_to, payload_hash,
    status, processing_started_at
  ) VALUES (
    p_event_source, p_external_id, p_event_type,
    p_installation_id, p_story_id, p_partner_id,
    p_routed_to, p_payload_hash,
    'processing', now()
  )
  ON CONFLICT (event_source, external_id) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    v_is_duplicate := true;
    SELECT id INTO v_event_id
    FROM integration_events
    WHERE event_source = p_event_source AND external_id = p_external_id;

    UPDATE integration_events
    SET status = 'skipped_duplicate'
    WHERE id = v_event_id AND status = 'received';
  END IF;

  RETURN jsonb_build_object(
    'event_id', v_event_id,
    'is_duplicate', v_is_duplicate,
    'status', CASE WHEN v_is_duplicate THEN 'skipped_duplicate' ELSE 'processing' END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_integration_event(text, text, text, bigint, uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_integration_event(text, text, text, bigint, uuid, uuid, text, text) TO service_role;
