-- Function: public.sync_health_data
-- Arguments: p_health_entries jsonb
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:09+01:00

CREATE OR REPLACE FUNCTION public.sync_health_data(p_health_entries jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_count INTEGER := 0;
  v_entry JSONB;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error_code', 'auth.not_authenticated');
  END IF;

  IF jsonb_typeof(p_health_entries) IS DISTINCT FROM 'array' THEN
    RETURN json_build_object('success', false, 'error_code', 'health.invalid_payload');
  END IF;

  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_health_entries)
  LOOP
    -- Basic payload validation (fail-closed per entry, do not accept partial/invalid rows)
    IF (v_entry ? 'data_type') IS FALSE
      OR (v_entry ? 'value') IS FALSE
      OR (v_entry ? 'unit') IS FALSE
      OR (v_entry ? 'recorded_at') IS FALSE
    THEN
      CONTINUE;
    END IF;

    INSERT INTO health_data (
      user_id,
      data_type,
      value,
      unit,
      metadata,
      recorded_at,
      source
    ) VALUES (
      v_user_id,
      v_entry->>'data_type',
      (v_entry->>'value')::numeric,
      v_entry->>'unit',
      COALESCE(v_entry->'metadata', '{}'::jsonb),
      (v_entry->>'recorded_at')::timestamptz,
      COALESCE(v_entry->>'source', 'manual')
    )
    ON CONFLICT (user_id, data_type, recorded_at)
    DO UPDATE SET
      value = EXCLUDED.value,
      unit = EXCLUDED.unit,
      metadata = EXCLUDED.metadata,
      source = EXCLUDED.source;

    v_count := v_count + 1;
  END LOOP;

  PERFORM public.write_audit_journal(
      p_action_type := 'create'::journal_action_type,
      p_area := 'health'::journal_area,
      p_details := jsonb_build_object('entries_count', v_count),
      p_entity_id := v_user_id::text,
      p_entity_type := 'health_data',
      p_severity := 'info'::journal_severity,
      p_summary := 'Synced ' || v_count || ' health data entries',
    p_user_id := v_user_id
  );

  RETURN json_build_object('success', true, 'synced_count', v_count);
EXCEPTION WHEN OTHERS THEN
  -- Do not return SQLERRM (can leak internal schema/constraint details).
  PERFORM public.write_audit_journal(
      p_action_type := 'create'::journal_action_type,
      p_area := 'health'::journal_area,
      p_details := jsonb_build_object('sqlstate', SQLSTATE),
      p_entity_id := v_user_id::text,
      p_entity_type := 'health_data',
      p_severity := 'error'::journal_severity,
      p_summary := 'Health data sync failed',
    p_user_id := v_user_id
  );

  RETURN json_build_object('success', false, 'error_code', 'health.sync_failed');
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.sync_health_data(p_health_entries jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_health_data(p_health_entries jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.sync_health_data(p_health_entries jsonb) TO authenticated;
