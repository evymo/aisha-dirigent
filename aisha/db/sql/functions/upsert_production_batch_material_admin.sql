-- Function: public.upsert_production_batch_material_admin
-- Creates or updates a batch material consumption/output record
-- SECURITY DEFINER with admin guard and audit log

CREATE OR REPLACE FUNCTION public.upsert_production_batch_material_admin(
  p_actual_qty numeric DEFAULT NULL,
  p_batch_id uuid DEFAULT NULL,
  p_direction text DEFAULT 'IN',
  p_id uuid DEFAULT NULL,
  p_item_id uuid DEFAULT NULL,
  p_lot_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_notes text DEFAULT NULL,
  p_planned_qty numeric DEFAULT NULL,
  p_step_id uuid DEFAULT NULL,
  p_uom text DEFAULT 'kg'
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

  IF p_batch_id IS NULL OR p_item_id IS NULL THEN
    RAISE EXCEPTION 'batch_id and item_id are required';
  END IF;

  IF p_id IS NOT NULL THEN
    v_action := 'update';
    UPDATE public.production_batch_materials SET
      batch_id = p_batch_id,
      step_id = p_step_id,
      lot_id = p_lot_id,
      item_id = p_item_id,
      direction = p_direction,
      planned_qty = p_planned_qty,
      actual_qty = p_actual_qty,
      uom = p_uom,
      notes = p_notes,
      metadata = p_metadata,
      updated_at = now()
    WHERE id = p_id
    RETURNING id INTO v_result_id;
  ELSE
    v_action := 'create';
    INSERT INTO public.production_batch_materials (
      batch_id, step_id, lot_id, item_id, direction,
      planned_qty, actual_qty, uom, notes, metadata, created_by
    ) VALUES (
      p_batch_id, p_step_id, p_lot_id, p_item_id, p_direction,
      p_planned_qty, p_actual_qty, p_uom,
      p_notes, p_metadata, auth.uid()
    )
    RETURNING id INTO v_result_id;
  END IF;

  PERFORM public.write_audit_journal(
    p_action_type := v_action::public.journal_action_type,
    p_area := 'products'::public.journal_area,
    p_details := NULL,
    p_entity_id := v_result_id::text,
    p_entity_type := 'production_batch_material',
    p_new_values := jsonb_build_object('batch_id', p_batch_id, 'direction', p_direction, 'item_id', p_item_id),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := format('Admin %s batch material %s', v_action, p_direction),
    p_tags := ARRAY['admin', 'production_batch_material'],
    p_user_id := auth.uid()
  );

  RETURN v_result_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_production_batch_material_admin(numeric, uuid, text, uuid, uuid, uuid, jsonb, text, numeric, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_production_batch_material_admin(numeric, uuid, text, uuid, uuid, uuid, jsonb, text, numeric, uuid, text) TO authenticated;
