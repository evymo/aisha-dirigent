-- Function: public.create_production_equipment_calibration_admin
-- Creates a calibration record for equipment
-- SECURITY DEFINER with admin guard and audit log

CREATE OR REPLACE FUNCTION public.create_production_equipment_calibration_admin(
  p_adjustment_made boolean DEFAULT false,
  p_calibration_type text DEFAULT NULL,
  p_certificate_doc_id uuid DEFAULT NULL,
  p_deviation_found numeric DEFAULT NULL,
  p_deviation_limit numeric DEFAULT NULL,
  p_equipment_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_next_due_at date DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_performed_at timestamptz DEFAULT now(),
  p_reference_standard text DEFAULT NULL,
  p_result text DEFAULT 'pass',
  p_verified_by uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result_id uuid;
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  IF p_equipment_id IS NULL OR p_calibration_type IS NULL THEN
    RAISE EXCEPTION 'equipment_id and calibration_type are required';
  END IF;

  INSERT INTO public.production_equipment_calibrations (
    equipment_id, calibration_type, performed_at, next_due_at,
    result, certificate_doc_id, reference_standard,
    deviation_found, deviation_limit, adjustment_made,
    performed_by, verified_by,
    verified_at, notes, metadata
  ) VALUES (
    p_equipment_id, p_calibration_type, p_performed_at, p_next_due_at,
    p_result, p_certificate_doc_id, p_reference_standard,
    p_deviation_found, p_deviation_limit, p_adjustment_made,
    auth.uid(), p_verified_by,
    CASE WHEN p_verified_by IS NOT NULL THEN now() ELSE NULL END,
    p_notes, p_metadata
  )
  RETURNING id INTO v_result_id;

  -- Update equipment last_qualified_at if calibration passed
  IF p_result = 'pass' THEN
    UPDATE public.production_equipment
    SET last_qualified_at = p_performed_at,
        next_qualification_due = p_next_due_at,
        updated_at = now()
    WHERE id = p_equipment_id;
  END IF;

  PERFORM public.write_audit_journal(
    p_action_type := 'create'::public.journal_action_type,
    p_area := 'products'::public.journal_area,
    p_details := NULL,
    p_entity_id := v_result_id::text,
    p_entity_type := 'production_equipment_calibration',
    p_new_values := jsonb_build_object('equipment_id', p_equipment_id, 'calibration_type', p_calibration_type, 'result', p_result),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := format('Admin created calibration record: %s result=%s', p_calibration_type, p_result),
    p_tags := ARRAY['admin', 'production_equipment_calibration'],
    p_user_id := auth.uid()
  );

  RETURN v_result_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_production_equipment_calibration_admin(boolean, text, uuid, numeric, numeric, uuid, jsonb, date, text, timestamptz, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_production_equipment_calibration_admin(boolean, text, uuid, numeric, numeric, uuid, jsonb, date, text, timestamptz, text, text, uuid) TO authenticated;
