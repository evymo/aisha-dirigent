-- Function: public.get_production_equipment_calibrations_admin
-- Returns equipment calibration records
-- SECURITY DEFINER with admin guard and audit log

CREATE OR REPLACE FUNCTION public.get_production_equipment_calibrations_admin(
  p_equipment_id uuid DEFAULT NULL,
  p_result text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  equipment_id uuid,
  calibration_type text,
  performed_at timestamptz,
  next_due_at date,
  result text,
  certificate_doc_id uuid,
  reference_standard text,
  deviation_found numeric,
  deviation_limit numeric,
  adjustment_made boolean,
  performed_by uuid,
  verified_by uuid,
  verified_at timestamptz,
  notes text,
  metadata jsonb,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  PERFORM public.write_audit_journal(
    p_action_type := 'read'::public.journal_action_type,
    p_area := 'products'::public.journal_area,
    p_details := NULL,
    p_entity_id := p_equipment_id::text,
    p_entity_type := 'production_equipment_calibration',
    p_new_values := jsonb_build_object('equipment_id', p_equipment_id, 'result', p_result),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := 'Admin read production equipment calibrations',
    p_tags := ARRAY['admin', 'production_equipment_calibration'],
    p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    pec.id, pec.equipment_id, pec.calibration_type, pec.performed_at,
    pec.next_due_at, pec.result, pec.certificate_doc_id,
    pec.reference_standard, pec.deviation_found, pec.deviation_limit,
    pec.adjustment_made, pec.performed_by, pec.verified_by,
    pec.verified_at, pec.notes, pec.metadata, pec.created_at
  FROM public.production_equipment_calibrations pec
  WHERE (p_equipment_id IS NULL OR pec.equipment_id = p_equipment_id)
    AND (p_result IS NULL OR pec.result = p_result)
  ORDER BY pec.performed_at DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_production_equipment_calibrations_admin(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_production_equipment_calibrations_admin(uuid, text) TO authenticated;
