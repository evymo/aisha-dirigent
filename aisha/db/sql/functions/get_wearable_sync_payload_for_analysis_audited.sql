-- Function: get_wearable_sync_payload_for_analysis_audited
-- Purpose: Returns minimal wearable sync payload for analysis generation (owner only)
-- Access: authenticated owner
-- Security: SECURITY DEFINER with audit logging

CREATE OR REPLACE FUNCTION public.get_wearable_sync_payload_for_analysis_audited(
  p_sync_batch_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_sync record;
  v_payload jsonb;
  v_sample_count integer := 0;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_sync_batch_id IS NULL THEN
    RAISE EXCEPTION 'sync_batch_id is required';
  END IF;

  SELECT
    hsl.id,
    hsl.data_source,
    hsl.records_count,
    hsl.inserted_count,
    hsl.skipped_count,
    hsl.error_count,
    hsl.sync_started_at,
    hsl.sync_completed_at
  INTO v_sync
  FROM public.health_data_sync_log hsl
  WHERE hsl.sync_batch_id = p_sync_batch_id
    AND hsl.user_id = v_user_id
  ORDER BY hsl.created_at DESC
  LIMIT 1;

  IF v_sync.id IS NULL THEN
    RAISE EXCEPTION 'Sync batch not found';
  END IF;

  SELECT COUNT(*)::integer
  INTO v_sample_count
  FROM public.wearables_data wd
  WHERE wd.user_id = v_user_id
    AND wd.metadata->>'sync_batch_id' = p_sync_batch_id::text;

  SELECT jsonb_build_object(
    'sync', jsonb_build_object(
      'sync_batch_id', p_sync_batch_id,
      'data_source', v_sync.data_source,
      'records_count', v_sync.records_count,
      'inserted_count', v_sync.inserted_count,
      'skipped_count', v_sync.skipped_count,
      'error_count', v_sync.error_count,
      'sync_started_at', v_sync.sync_started_at,
      'sync_completed_at', v_sync.sync_completed_at
    ),
    'aggregates', jsonb_build_object(
      'samples', COALESCE(v_sample_count, 0),
      'steps_total', COALESCE(SUM(NULLIF(wd.metadata->>'steps_count', '')::numeric), 0),
      'steps_avg', COALESCE(AVG(NULLIF(wd.metadata->>'steps_count', '')::numeric), 0),
      'sleep_hours_avg', COALESCE(AVG(NULLIF(wd.metadata->>'sleep_hours', '')::numeric), 0),
      'heart_rate_avg', COALESCE(AVG(NULLIF(wd.metadata->>'heart_rate_avg', '')::numeric), 0),
      'heart_rate_max', COALESCE(MAX(NULLIF(wd.metadata->>'heart_rate_max', '')::numeric), 0),
      'activity_minutes_total', COALESCE(SUM(NULLIF(wd.metadata->>'activity_minutes', '')::numeric), 0),
      'distance_meters_total', COALESCE(SUM(NULLIF(wd.metadata->>'distance_meters', '')::numeric), 0)
    )
  )
  INTO v_payload
  FROM public.wearables_data wd
  WHERE wd.user_id = v_user_id
    AND wd.metadata->>'sync_batch_id' = p_sync_batch_id::text;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    v_user_id,
    'WEARABLE_SYNC_ANALYSIS_CONTEXT',
    jsonb_build_object(
      'area', 'wearable',
      'severity', 'info',
      'sync_batch_id', p_sync_batch_id,
      'sample_count', v_sample_count
    )
  );

  RETURN COALESCE(
    v_payload,
    jsonb_build_object(
      'sync', jsonb_build_object(
        'sync_batch_id', p_sync_batch_id,
        'data_source', v_sync.data_source,
        'records_count', v_sync.records_count,
        'inserted_count', v_sync.inserted_count,
        'skipped_count', v_sync.skipped_count,
        'error_count', v_sync.error_count
      ),
      'aggregates', jsonb_build_object(
        'samples', 0,
        'steps_total', 0,
        'steps_avg', 0,
        'sleep_hours_avg', 0,
        'heart_rate_avg', 0,
        'heart_rate_max', 0,
        'activity_minutes_total', 0,
        'distance_meters_total', 0
      )
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_wearable_sync_payload_for_analysis_audited(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_wearable_sync_payload_for_analysis_audited(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_wearable_sync_payload_for_analysis_audited(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_wearable_sync_payload_for_analysis_audited(uuid) TO service_role;

COMMENT ON FUNCTION public.get_wearable_sync_payload_for_analysis_audited(uuid) IS
  'Returns owner-scoped wearable sync aggregate payload for analysis generation.';
