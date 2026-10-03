-- Function: public.create_production_equipment_cleaning_admin
-- Creates a cleaning/sanitation record for equipment
-- SECURITY DEFINER with admin guard and audit log

CREATE OR REPLACE FUNCTION public.create_production_equipment_cleaning_admin(
  p_batch_id_after uuid DEFAULT NULL,
  p_batch_id_before uuid DEFAULT NULL,
  p_cleaning_agent text DEFAULT NULL,
  p_cleaning_method text DEFAULT NULL,
  p_equipment_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_notes text DEFAULT NULL,
  p_performed_at timestamptz DEFAULT now(),
  p_status text DEFAULT 'completed',
  p_swab_results jsonb DEFAULT NULL,
  p_verified_by uuid DEFAULT NULL,
  p_visual_inspection text DEFAULT NULL
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

  IF p_equipment_id IS NULL OR p_cleaning_method IS NULL THEN
    RAISE EXCEPTION 'equipment_id and cleaning_method are required';
  END IF;

  INSERT INTO public.production_equipment_cleaning (
    equipment_id, cleaning_method, cleaning_agent,
    performed_at, performed_by, verified_by,
    verified_at, swab_results, visual_inspection,
    status, batch_id_before, batch_id_after, notes, metadata
  ) VALUES (
    p_equipment_id, p_cleaning_method, p_cleaning_agent,
    p_performed_at, auth.uid(), p_verified_by,
    CASE WHEN p_verified_by IS NOT NULL THEN now() ELSE NULL END,
    p_swab_results, p_visual_inspection,
    p_status, p_batch_id_before, p_batch_id_after, p_notes, p_metadata
  )
  RETURNING id INTO v_result_id;

  PERFORM public.write_audit_journal(
    p_action_type := 'create'::public.journal_action_type,
    p_area := 'products'::public.journal_area,
    p_details := NULL,
    p_entity_id := v_result_id::text,
    p_entity_type := 'production_equipment_cleaning',
    p_new_values := jsonb_build_object('equipment_id', p_equipment_id, 'cleaning_method', p_cleaning_method, 'status', p_status),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := format('Admin created cleaning record: method=%s', p_cleaning_method),
    p_tags := ARRAY['admin', 'production_equipment_cleaning'],
    p_user_id := auth.uid()
  );

  RETURN v_result_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_production_equipment_cleaning_admin(uuid, uuid, text, text, uuid, jsonb, text, timestamptz, text, jsonb, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_production_equipment_cleaning_admin(uuid, uuid, text, text, uuid, jsonb, text, timestamptz, text, jsonb, uuid, text) TO authenticated;
