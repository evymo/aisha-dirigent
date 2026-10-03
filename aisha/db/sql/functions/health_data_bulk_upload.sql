-- Function: public.health_data_bulk_upload
-- Arguments: p_health_records jsonb
-- Description:
--   Mobile bulk ingest for wearable summaries.
--   IMPORTANT: this function writes to wearables_data (system stream),
--   not to member-entered health_check_ins.
-- Security: SECURITY DEFINER with explicit search_path

CREATE OR REPLACE FUNCTION public.health_data_bulk_upload(p_health_records jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_sync_batch_id UUID;
  v_sync_started TIMESTAMPTZ;
  v_sync_completed TIMESTAMPTZ;
  v_inserted_count INTEGER := 0;
  v_skipped_count INTEGER := 0;
  v_error_count INTEGER := 0;
  v_records_count INTEGER;
  v_data_source TEXT;
  v_device_info TEXT;
  v_points_awarded INTEGER := 0;
  v_validated_records JSONB;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- RATE LIMITING: 10 requests per minute
  PERFORM enforce_rate_limit('health_data_bulk_upload', 60000, 10);

  -- Validate input
  IF jsonb_typeof(p_health_records) != 'array' THEN
    RAISE EXCEPTION 'p_health_records must be an array';
  END IF;

  v_records_count := jsonb_array_length(p_health_records);

  IF v_records_count = 0 OR v_records_count > 100 THEN
    RAISE EXCEPTION 'Records count must be between 1 and 100, got %', v_records_count;
  END IF;

  -- Generate sync batch ID
  v_sync_batch_id := gen_random_uuid();
  v_sync_started := now();

  -- Extract data_source and device_info from first record
  v_data_source := COALESCE(p_health_records->0->>'data_source', 'manual');
  v_device_info := p_health_records->0->>'device_info';

  -- STEP 1: Validate and filter records, counting errors
  WITH validated AS (
    SELECT
      r.value as record,
      CASE
        -- Validate steps_count
        WHEN (r.value->>'steps_count')::INTEGER IS NOT NULL
          AND ((r.value->>'steps_count')::INTEGER < 0 OR (r.value->>'steps_count')::INTEGER > 200000)
          THEN 'invalid_steps'
        -- Validate heart_rate_avg
        WHEN (r.value->>'heart_rate_avg')::INTEGER IS NOT NULL
          AND ((r.value->>'heart_rate_avg')::INTEGER < 30 OR (r.value->>'heart_rate_avg')::INTEGER > 300)
          THEN 'invalid_heart_rate'
        -- Validate sleep_hours
        WHEN (r.value->>'sleep_hours')::NUMERIC IS NOT NULL
          AND ((r.value->>'sleep_hours')::NUMERIC < 0 OR (r.value->>'sleep_hours')::NUMERIC > 24)
          THEN 'invalid_sleep'
        -- Validate check_in_date
        WHEN (r.value->>'check_in_date')::DATE IS NULL
          THEN 'missing_date'
        ELSE NULL
      END as validation_error
    FROM jsonb_array_elements(p_health_records) r
  )
  SELECT
    COUNT(*) FILTER (WHERE validation_error IS NOT NULL)::INTEGER,
    jsonb_agg(record) FILTER (WHERE validation_error IS NULL)
  INTO v_error_count, v_validated_records
  FROM validated;

  -- If no valid records, return early
  IF v_validated_records IS NULL OR jsonb_array_length(v_validated_records) = 0 THEN
    v_sync_completed := now();

    -- Log sync operation
    INSERT INTO health_data_sync_log (
      user_id, sync_batch_id, records_count, data_source, device_info,
      inserted_count, skipped_count, error_count,
      sync_started_at, sync_completed_at, duration_ms
    ) VALUES (
      v_user_id, v_sync_batch_id, v_records_count, v_data_source, v_device_info,
      0, 0, v_error_count,
      v_sync_started, v_sync_completed,
      EXTRACT(EPOCH FROM (v_sync_completed - v_sync_started)) * 1000
    );

    RETURN jsonb_build_object(
      'success', false,
      'inserted_count', 0,
      'skipped_count', 0,
      'error_count', v_error_count,
      'sync_batch_id', v_sync_batch_id,
      'points_awarded', 0,
      'message', 'All records failed validation'
    );
  END IF;

  -- STEP 2: Batch INSERT into wearables_data with duplicate detection
  -- NOTE: health_check_ins are user-entered records and remain separate.
  WITH input_records AS (
    SELECT
      (r.value->>'check_in_date')::DATE as check_in_date,
      COALESCE(r.value->>'check_in_type', 'daily') as check_in_type,
      (r.value->>'steps_count')::INTEGER as steps_count,
      (r.value->>'sleep_hours')::NUMERIC as sleep_hours,
      (r.value->>'sleep_quality')::INTEGER as sleep_quality,
      (r.value->>'energy_level')::INTEGER as energy_level,
      (r.value->>'mood_level')::INTEGER as mood_level,
      (r.value->>'pain_level')::INTEGER as pain_level,
      (r.value->>'activity_minutes')::INTEGER as activity_minutes,
      (r.value->>'heart_rate_avg')::INTEGER as heart_rate_avg,
      (r.value->>'heart_rate_min')::INTEGER as heart_rate_min,
      (r.value->>'heart_rate_max')::INTEGER as heart_rate_max,
      (r.value->>'active_energy_burned')::INTEGER as active_energy_burned,
      (r.value->>'distance_meters')::INTEGER as distance_meters,
      r.value->>'data_source' as data_source,
      r.value->>'device_info' as device_info
    FROM jsonb_array_elements(v_validated_records) r
  ),
  new_records AS (
    SELECT ir.*
    FROM input_records ir
    WHERE NOT EXISTS (
      SELECT 1
      FROM wearables_data wd
      WHERE wd.user_id = v_user_id
        AND wd.device_type = COALESCE(ir.data_source, 'wearable_unknown')
        AND wd.data_type = COALESCE(ir.check_in_type, 'daily')
        AND wd.recorded_at = ir.check_in_date::timestamptz
    )
  ),
  inserted AS (
    INSERT INTO wearables_data (
      user_id,
      device_type,
      data_type,
      recorded_at,
      value,
      unit,
      metadata
    )
    SELECT
      v_user_id,
      COALESCE(data_source, 'wearable_unknown'),
      COALESCE(check_in_type, 'daily'),
      check_in_date::timestamptz,
      NULL::numeric,
      NULL::text,
      jsonb_strip_nulls(
        jsonb_build_object(
          'summary_kind', 'daily_health_record',
          'sync_batch_id', v_sync_batch_id,
          'check_in_date', check_in_date,
          'check_in_type', check_in_type,
          'steps_count', steps_count,
          'sleep_hours', sleep_hours,
          'sleep_quality', sleep_quality,
          'energy_level', energy_level,
          'mood_level', mood_level,
          'pain_level', pain_level,
          'activity_minutes', activity_minutes,
          'heart_rate_avg', heart_rate_avg,
          'heart_rate_min', heart_rate_min,
          'heart_rate_max', heart_rate_max,
          'active_energy_burned', active_energy_burned,
          'distance_meters', distance_meters,
          'data_source', data_source,
          'device_info', device_info
        )
      )
    FROM new_records
    RETURNING 1
  )
  SELECT COUNT(*)::INTEGER INTO v_inserted_count FROM inserted;

  -- Calculate skipped count
  v_skipped_count := jsonb_array_length(v_validated_records) - v_inserted_count;

  v_sync_completed := now();

  -- Log sync operation
  INSERT INTO health_data_sync_log (
    user_id, sync_batch_id, records_count, data_source, device_info,
    inserted_count, skipped_count, error_count,
    sync_started_at, sync_completed_at, duration_ms
  ) VALUES (
    v_user_id, v_sync_batch_id, v_records_count, v_data_source, v_device_info,
    v_inserted_count, v_skipped_count, v_error_count,
    v_sync_started, v_sync_completed,
    EXTRACT(EPOCH FROM (v_sync_completed - v_sync_started)) * 1000
  );

  -- Award points (10 points per successfully ingested wearable summary)
  v_points_awarded := v_inserted_count * 10;

  IF v_points_awarded > 0 THEN
    -- Update token balance
    INSERT INTO token_allocations (user_id, balance, updated_at)
    VALUES (v_user_id, v_points_awarded, now())
    ON CONFLICT (user_id)
    DO UPDATE SET
      balance = token_allocations.balance + v_points_awarded,
      updated_at = now();

    -- Create token transaction
    INSERT INTO token_transactions (
      to_user_id, amount, transaction_type, reference_type, reference_id,
      description, created_at
    ) VALUES (
      v_user_id, v_points_awarded, 'reward', 'health_sync', v_sync_batch_id,
      format('Wearable data sync: %s records', v_inserted_count), now()
    );

    -- Audit log (no sensitive data values in details)
    PERFORM public.write_audit_journal(
        p_action_type := 'insert'::journal_action_type,
        p_area := 'health'::journal_area,
        p_details := jsonb_build_object(
        'inserted_count', v_inserted_count,
        'skipped_count', v_skipped_count,
        'error_count', v_error_count,
        'points_awarded', v_points_awarded
      ),
        p_entity_id := v_sync_batch_id,
        p_entity_type := 'wearables_data',
        p_new_values := NULL,
        p_old_values := NULL,
        p_severity := 'notice'::journal_severity,
        p_summary := 'Bulk wearable data sync from mobile',
        p_tags := ARRAY['mobile', 'health_sync', v_data_source],
        p_user_id := v_user_id
    );
  END IF;

  -- Return result
  RETURN jsonb_build_object(
    'success', true,
    'inserted_count', v_inserted_count,
    'skipped_count', v_skipped_count,
    'error_count', v_error_count,
    'sync_batch_id', v_sync_batch_id,
    'points_awarded', v_points_awarded
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.health_data_bulk_upload(p_health_records jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.health_data_bulk_upload(p_health_records jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.health_data_bulk_upload(p_health_records jsonb) TO authenticated;
