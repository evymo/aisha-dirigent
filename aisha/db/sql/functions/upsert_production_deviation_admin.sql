-- Function: public.upsert_production_deviation_admin
-- Creates or updates a deviation/investigation record
-- SECURITY DEFINER with admin guard and audit log

CREATE OR REPLACE FUNCTION public.upsert_production_deviation_admin(
  p_approved_by uuid DEFAULT NULL,
  p_batch_id uuid DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_deviation_number text DEFAULT NULL,
  p_disposition text DEFAULT NULL,
  p_equipment_id uuid DEFAULT NULL,
  p_id uuid DEFAULT NULL,
  p_immediate_action text DEFAULT NULL,
  p_investigated_by uuid DEFAULT NULL,
  p_lot_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_notes text DEFAULT NULL,
  p_root_cause text DEFAULT NULL,
  p_severity text DEFAULT 'minor',
  p_status text DEFAULT 'open',
  p_step_id uuid DEFAULT NULL,
  p_title text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result_id uuid;
  v_action text;
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  IF p_deviation_number IS NULL OR p_title IS NULL OR p_description IS NULL THEN
    RAISE EXCEPTION 'deviation_number, title and description are required';
  END IF;

  IF p_id IS NOT NULL THEN
    v_action := 'update';
    UPDATE public.production_deviations SET
      deviation_number = p_deviation_number,
      batch_id = p_batch_id,
      step_id = p_step_id,
      equipment_id = p_equipment_id,
      lot_id = p_lot_id,
      severity = p_severity,
      category = p_category,
      title = p_title,
      description = p_description,
      root_cause = p_root_cause,
      immediate_action = p_immediate_action,
      disposition = p_disposition,
      status = p_status,
      investigated_by = p_investigated_by,
      resolved_at = CASE WHEN p_status IN ('resolved', 'closed') AND status NOT IN ('resolved', 'closed') THEN now() ELSE resolved_at END,
      resolved_by = CASE WHEN p_status IN ('resolved', 'closed') AND status NOT IN ('resolved', 'closed') THEN auth.uid() ELSE resolved_by END,
      approved_by = p_approved_by,
      approved_at = CASE WHEN p_approved_by IS NOT NULL AND approved_by IS NULL THEN now() ELSE approved_at END,
      notes = p_notes,
      metadata = p_metadata,
      updated_at = now()
    WHERE id = p_id
    RETURNING id INTO v_result_id;
  ELSE
    v_action := 'create';
    INSERT INTO public.production_deviations (
      deviation_number, batch_id, step_id, equipment_id, lot_id,
      severity, category, title, description,
      root_cause, immediate_action, disposition, status,
      initiated_at, initiated_by, investigated_by,
      notes, metadata
    ) VALUES (
      p_deviation_number, p_batch_id, p_step_id, p_equipment_id, p_lot_id,
      p_severity, p_category, p_title, p_description,
      p_root_cause, p_immediate_action, p_disposition, p_status,
      now(), auth.uid(), p_investigated_by,
      p_notes, p_metadata
    )
    RETURNING id INTO v_result_id;
  END IF;

  PERFORM public.write_audit_journal(
    p_action_type := v_action::public.journal_action_type,
    p_area := 'products'::public.journal_area,
    p_details := NULL,
    p_entity_id := v_result_id::text,
    p_entity_type := 'production_deviation',
    p_new_values := jsonb_build_object('deviation_number', p_deviation_number, 'severity', p_severity, 'status', p_status),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := format('Admin %s production deviation %s (%s)', v_action, p_deviation_number, p_severity),
    p_tags := ARRAY['admin', 'production_deviation'],
    p_user_id := auth.uid()
  );

  RETURN v_result_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_production_deviation_admin(uuid, uuid, text, text, text, text, uuid, uuid, text, uuid, uuid, jsonb, text, text, text, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_production_deviation_admin(uuid, uuid, text, text, text, text, uuid, uuid, text, uuid, uuid, jsonb, text, text, text, text, uuid, text) TO authenticated;
