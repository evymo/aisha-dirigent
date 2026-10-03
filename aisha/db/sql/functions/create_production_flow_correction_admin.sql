-- Function: public.create_production_flow_correction_admin
-- Arguments: p_concentration_pct numeric, p_correction_reason text, p_lot_id uuid, p_notes text, p_original_record_id uuid, p_temperature_c numeric, p_volume_l numeric
-- Description: Create a correction (storno + new record) for an existing flow record in one transaction.
-- Security: SECURITY DEFINER, admin/staff only
-- Source: Migration 20260219180000_production_enhancements.sql

CREATE OR REPLACE FUNCTION public.create_production_flow_correction_admin(
  p_concentration_pct numeric DEFAULT NULL,
  p_correction_reason text DEFAULT NULL,
  p_lot_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_original_record_id uuid DEFAULT NULL,
  p_temperature_c numeric DEFAULT NULL,
  p_volume_l numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_orig production_flow_records%ROWTYPE;
  v_storno_id uuid;
  v_correction_id uuid;
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  IF p_original_record_id IS NULL THEN
    RAISE EXCEPTION 'original_record_id is required';
  END IF;

  -- Fetch original record
  SELECT * INTO v_orig
  FROM production_flow_records
  WHERE id = p_original_record_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Original record not found: %', p_original_record_id;
  END IF;

  IF v_orig.is_storno THEN
    RAISE EXCEPTION 'Cannot correct a storno record' USING ERRCODE = 'P0001';
  END IF;

  -- 1. Create STORNO record (reversal — negated volume)
  INSERT INTO production_flow_records (
    batch_id, substance_id, source_node_id, target_node_id,
    flow_date, volume_l, concentration_pct,
    temperature_c, lot_id, responsible_user_id,
    notes, metadata,
    is_storno, is_correction, corrects_record_id, correction_reason
  ) VALUES (
    v_orig.batch_id, v_orig.substance_id,
    v_orig.target_node_id, v_orig.source_node_id, -- REVERSED direction
    now(), -(v_orig.volume_l), v_orig.concentration_pct,
    v_orig.temperature_c, v_orig.lot_id, auth.uid(),
    format('STORNO of record %s: %s', p_original_record_id, COALESCE(p_correction_reason, '')),
    jsonb_build_object('storno_of', p_original_record_id),
    true, false, p_original_record_id, p_correction_reason
  )
  RETURNING id INTO v_storno_id;

  -- 2. Create CORRECTION record (new correct values)
  INSERT INTO production_flow_records (
    batch_id, substance_id, source_node_id, target_node_id,
    flow_date, volume_l, concentration_pct,
    temperature_c, lot_id, responsible_user_id,
    notes, metadata,
    is_storno, is_correction, corrects_record_id, correction_reason
  ) VALUES (
    v_orig.batch_id, v_orig.substance_id,
    v_orig.source_node_id, v_orig.target_node_id,
    now(),
    COALESCE(p_volume_l, v_orig.volume_l),
    COALESCE(p_concentration_pct, v_orig.concentration_pct),
    COALESCE(p_temperature_c, v_orig.temperature_c),
    COALESCE(p_lot_id, v_orig.lot_id),
    auth.uid(),
    COALESCE(p_notes, format('Correction of record %s', p_original_record_id)),
    jsonb_build_object('correction_of', p_original_record_id, 'storno_id', v_storno_id),
    false, true, p_original_record_id, p_correction_reason
  )
  RETURNING id INTO v_correction_id;

  -- Audit
  PERFORM public.write_audit_journal(
    p_action_type := 'update'::public.journal_action_type,
    p_area := 'production'::public.journal_area,
    p_details := NULL,
    p_entity_id := p_original_record_id::text,
    p_entity_type := 'production_flow_record_correction',
    p_new_values := jsonb_build_object(
      'storno_id', v_storno_id,
      'correction_id', v_correction_id,
      'new_volume_l', COALESCE(p_volume_l, v_orig.volume_l),
      'new_concentration_pct', COALESCE(p_concentration_pct, v_orig.concentration_pct)
    ),
    p_old_values := jsonb_build_object(
      'original_volume_l', v_orig.volume_l,
      'original_concentration_pct', v_orig.concentration_pct
    ),
    p_severity := 'notice'::public.journal_severity,
    p_summary := format('Flow record corrected: %s (storno: %s, correction: %s)',
      p_original_record_id, v_storno_id, v_correction_id),
    p_tags := ARRAY['admin', 'flow_tracking', 'correction'],
    p_user_id := auth.uid()
  );

  RETURN jsonb_build_object(
    'original_id', p_original_record_id,
    'storno_id', v_storno_id,
    'correction_id', v_correction_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_production_flow_correction_admin(numeric, text, uuid, text, uuid, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_production_flow_correction_admin(numeric, text, uuid, text, uuid, numeric, numeric) TO authenticated;
