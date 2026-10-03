-- Function: public.sync_health_data_with_conflict_resolution
-- Arguments: p_health_records jsonb, p_conflict_resolution text
-- Description: Sync health data from mobile app (sensitive data)
-- @security: authenticated
-- @audit: required
-- @phi: true

CREATE OR REPLACE FUNCTION public.sync_health_data_with_conflict_resolution(p_health_records jsonb, p_conflict_resolution text DEFAULT 'server_wins'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_sync_batch_id UUID;
  v_record JSONB;
  v_existing RECORD;
  v_inserted_count INTEGER := 0;
  v_updated_count INTEGER := 0;
  v_skipped_count INTEGER := 0;
  v_conflict_count INTEGER := 0;
  v_points_awarded INTEGER := 0;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Audit sensitive data sync
  PERFORM public.write_audit_journal(
      p_action_type := 'update'::journal_action_type,
      p_area := 'studies'::journal_area,
      p_details := jsonb_build_object('records_count', jsonb_array_length(p_health_records), 'conflict_resolution', p_conflict_resolution),
      p_entity_id := NULL,
      p_entity_type := 'health_data',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Member synced health data',
      p_tags := ARRAY['phi','member','health_sync'],
      p_user_id := v_user_id
  );

  -- Rate limiting
  PERFORM enforce_rate_limit('sync_health_data_with_conflict_resolution', 60000, 10);

  -- Validate input
  IF jsonb_typeof(p_health_records) != 'array' THEN
    RAISE EXCEPTION 'p_health_records must be an array';
  END IF;

  IF jsonb_array_length(p_health_records) > 100 THEN
    RAISE EXCEPTION 'Maximum 100 records per sync';
  END IF;

  v_sync_batch_id := gen_random_uuid();

  FOR v_record IN SELECT * FROM jsonb_array_elements(p_health_records)
  LOOP
    -- Check for existing record
    SELECT * INTO v_existing
    FROM health_check_ins
    WHERE user_id = v_user_id
      AND check_in_date = (v_record->>'check_in_date')::DATE
      AND data_source = COALESCE(v_record->>'data_source', 'manual');

    IF v_existing IS NOT NULL THEN
      -- Conflict detection
      IF p_conflict_resolution = 'server_wins' THEN
        -- Skip, keep server version
        v_skipped_count := v_skipped_count + 1;

      ELSIF p_conflict_resolution = 'client_wins' THEN
        -- Update with client data
        UPDATE health_check_ins SET
          steps_count = COALESCE((v_record->>'steps_count')::INTEGER, steps_count),
          sleep_hours = COALESCE((v_record->>'sleep_hours')::NUMERIC, sleep_hours),
          sleep_quality = COALESCE((v_record->>'sleep_quality')::INTEGER, sleep_quality),
          energy_level = COALESCE((v_record->>'energy_level')::INTEGER, energy_level),
          mood_level = COALESCE((v_record->>'mood_level')::INTEGER, mood_level),
          pain_level = COALESCE((v_record->>'pain_level')::INTEGER, pain_level),
          heart_rate_avg = COALESCE((v_record->>'heart_rate_avg')::INTEGER, heart_rate_avg),
          client_synced_at = COALESCE((v_record->>'client_synced_at')::TIMESTAMPTZ, now()),
          sync_status = 'synced',
          synced_at = now(),
          sync_batch_id = v_sync_batch_id
        WHERE id = v_existing.id;
        v_updated_count := v_updated_count + 1;

      ELSIF p_conflict_resolution = 'merge' THEN
        -- Merge: take non-null values from client, keep server values for nulls
        UPDATE health_check_ins SET
          steps_count = COALESCE((v_record->>'steps_count')::INTEGER, steps_count),
          sleep_hours = COALESCE((v_record->>'sleep_hours')::NUMERIC, sleep_hours),
          sleep_quality = COALESCE((v_record->>'sleep_quality')::INTEGER, sleep_quality),
          energy_level = COALESCE((v_record->>'energy_level')::INTEGER, energy_level),
          mood_level = COALESCE((v_record->>'mood_level')::INTEGER, mood_level),
          pain_level = COALESCE((v_record->>'pain_level')::INTEGER, pain_level),
          heart_rate_avg = GREATEST(
            COALESCE((v_record->>'heart_rate_avg')::INTEGER, 0),
            COALESCE(heart_rate_avg, 0)
          ),
          heart_rate_min = LEAST(
            COALESCE((v_record->>'heart_rate_min')::INTEGER, 999),
            COALESCE(heart_rate_min, 999)
          ),
          heart_rate_max = GREATEST(
            COALESCE((v_record->>'heart_rate_max')::INTEGER, 0),
            COALESCE(heart_rate_max, 0)
          ),
          active_energy_burned = GREATEST(
            COALESCE((v_record->>'active_energy_burned')::INTEGER, 0),
            COALESCE(active_energy_burned, 0)
          ),
          distance_meters = GREATEST(
            COALESCE((v_record->>'distance_meters')::INTEGER, 0),
            COALESCE(distance_meters, 0)
          ),
          client_synced_at = COALESCE((v_record->>'client_synced_at')::TIMESTAMPTZ, now()),
          sync_status = 'synced',
          synced_at = now(),
          sync_batch_id = v_sync_batch_id
        WHERE id = v_existing.id;
        v_updated_count := v_updated_count + 1;
      END IF;

      v_conflict_count := v_conflict_count + 1;
    ELSE
      -- No conflict, insert new record
      INSERT INTO health_check_ins (
        user_id, check_in_date, check_in_type, steps_count, sleep_hours,
        sleep_quality, energy_level, mood_level, pain_level, activity_minutes,
        heart_rate_avg, heart_rate_min, heart_rate_max,
        active_energy_burned, distance_meters,
        data_source, device_info, sync_batch_id, synced_at,
        client_synced_at, sync_status
      ) VALUES (
        v_user_id,
        (v_record->>'check_in_date')::DATE,
        COALESCE(v_record->>'check_in_type', 'daily'),
        (v_record->>'steps_count')::INTEGER,
        (v_record->>'sleep_hours')::NUMERIC,
        (v_record->>'sleep_quality')::INTEGER,
        (v_record->>'energy_level')::INTEGER,
        (v_record->>'mood_level')::INTEGER,
        (v_record->>'pain_level')::INTEGER,
        (v_record->>'activity_minutes')::INTEGER,
        (v_record->>'heart_rate_avg')::INTEGER,
        (v_record->>'heart_rate_min')::INTEGER,
        (v_record->>'heart_rate_max')::INTEGER,
        (v_record->>'active_energy_burned')::INTEGER,
        (v_record->>'distance_meters')::INTEGER,
        COALESCE(v_record->>'data_source', 'manual'),
        v_record->>'device_info',
        v_sync_batch_id,
        now(),
        (v_record->>'client_synced_at')::TIMESTAMPTZ,
        'synced'
      );
      v_inserted_count := v_inserted_count + 1;
    END IF;
  END LOOP;

  -- Award points for new records only
  v_points_awarded := v_inserted_count * 10;

  IF v_points_awarded > 0 THEN
    INSERT INTO token_allocations (user_id, balance, updated_at)
    VALUES (v_user_id, v_points_awarded, now())
    ON CONFLICT (user_id)
    DO UPDATE SET
      balance = token_allocations.balance + v_points_awarded,
      updated_at = now();

    INSERT INTO token_transactions (
      to_user_id, amount, transaction_type, reference_type, reference_id,
      description, created_at
    ) VALUES (
      v_user_id, v_points_awarded, 'reward', 'health_sync', v_sync_batch_id,
      format('Health sync with conflict resolution: %s new records', v_inserted_count), now()
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'inserted_count', v_inserted_count,
    'updated_count', v_updated_count,
    'skipped_count', v_skipped_count,
    'conflict_count', v_conflict_count,
    'conflict_resolution', p_conflict_resolution,
    'sync_batch_id', v_sync_batch_id,
    'points_awarded', v_points_awarded
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.sync_health_data_with_conflict_resolution(p_health_records jsonb, p_conflict_resolution text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_health_data_with_conflict_resolution(p_health_records jsonb, p_conflict_resolution text) FROM anon;
GRANT EXECUTE ON FUNCTION public.sync_health_data_with_conflict_resolution(p_health_records jsonb, p_conflict_resolution text) TO authenticated;
