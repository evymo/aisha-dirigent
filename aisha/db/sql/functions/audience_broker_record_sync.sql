-- Function: audience_broker_record_sync

CREATE OR REPLACE FUNCTION public.audience_broker_record_sync(p_source_slug text, p_started_at timestamp with time zone, p_finished_at timestamp with time zone, p_ok boolean, p_error_message text DEFAULT NULL::text, p_recent_active integer DEFAULT 0, p_upserted integer DEFAULT 0, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS audience_broker_sync_state
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.audience_broker_sync_state;
BEGIN
  INSERT INTO public.audience_broker_sync_state AS s (
    source_slug, last_sync_started_at, last_sync_finished_at,
    last_success_at, last_error_at, last_error_message,
    consecutive_failures, total_syncs, total_failures,
    last_recent_active_count, last_upserted_count,
    metadata, updated_at
  )
  VALUES (
    p_source_slug, p_started_at, p_finished_at,
    CASE WHEN p_ok THEN p_finished_at ELSE NULL END,
    CASE WHEN p_ok THEN NULL ELSE p_finished_at END,
    p_error_message,
    CASE WHEN p_ok THEN 0 ELSE 1 END,
    1,
    CASE WHEN p_ok THEN 0 ELSE 1 END,
    p_recent_active, p_upserted,
    p_metadata, now()
  )
  ON CONFLICT (source_slug) DO UPDATE
    SET last_sync_started_at  = EXCLUDED.last_sync_started_at,
        last_sync_finished_at = EXCLUDED.last_sync_finished_at,
        last_success_at       = CASE WHEN p_ok THEN p_finished_at ELSE s.last_success_at END,
        last_error_at         = CASE WHEN p_ok THEN s.last_error_at ELSE p_finished_at END,
        last_error_message    = CASE WHEN p_ok THEN NULL ELSE p_error_message END,
        consecutive_failures  = CASE WHEN p_ok THEN 0 ELSE s.consecutive_failures + 1 END,
        total_syncs           = s.total_syncs + 1,
        total_failures        = s.total_failures + (CASE WHEN p_ok THEN 0 ELSE 1 END),
        last_recent_active_count = p_recent_active,
        last_upserted_count   = p_upserted,
        metadata              = p_metadata,
        updated_at            = now()
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$

;

REVOKE ALL ON FUNCTION audience_broker_record_sync(text,timestamp with time zone,timestamp with time zone,boolean,text,integer,integer,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audience_broker_record_sync(text,timestamp with time zone,timestamp with time zone,boolean,text,integer,integer,jsonb) TO authenticator;
GRANT EXECUTE ON FUNCTION audience_broker_record_sync(text,timestamp with time zone,timestamp with time zone,boolean,text,integer,integer,jsonb) TO service_role;
