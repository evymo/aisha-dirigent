-- Function: public.create_production_inventory_event_admin
-- Creates an immutable inventory ledger event (no updates allowed)
-- SECURITY DEFINER with admin guard and audit log

CREATE OR REPLACE FUNCTION public.create_production_inventory_event_admin(
  p_event_type text DEFAULT NULL,
  p_location_id uuid DEFAULT NULL,
  p_lot_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_quantity numeric DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_ref_id uuid DEFAULT NULL,
  p_ref_type text DEFAULT NULL,
  p_uom text DEFAULT 'kg'
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

  IF p_lot_id IS NULL OR p_event_type IS NULL OR p_quantity IS NULL THEN
    RAISE EXCEPTION 'lot_id, event_type and quantity are required';
  END IF;

  INSERT INTO public.production_inventory_events (
    lot_id, location_id, event_type, quantity, uom,
    ref_type, ref_id, reason, performed_by, performed_at, metadata
  ) VALUES (
    p_lot_id, p_location_id, p_event_type, p_quantity, p_uom,
    p_ref_type, p_ref_id, p_reason, auth.uid(), now(), p_metadata
  )
  RETURNING id INTO v_result_id;

  -- Update remaining_quantity on the lot
  UPDATE public.production_lots
  SET remaining_quantity = COALESCE(remaining_quantity, 0) + p_quantity,
      updated_at = now()
  WHERE id = p_lot_id;

  PERFORM public.write_audit_journal(
    p_action_type := 'create'::public.journal_action_type,
    p_area := 'products'::public.journal_area,
    p_details := NULL,
    p_entity_id := v_result_id::text,
    p_entity_type := 'production_inventory_event',
    p_new_values := jsonb_build_object('event_type', p_event_type, 'quantity', p_quantity, 'lot_id', p_lot_id),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := format('Admin created inventory event %s qty=%s', p_event_type, p_quantity),
    p_tags := ARRAY['admin', 'production_inventory_event'],
    p_user_id := auth.uid()
  );

  RETURN v_result_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_production_inventory_event_admin(text, uuid, uuid, jsonb, numeric, text, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_production_inventory_event_admin(text, uuid, uuid, jsonb, numeric, text, uuid, text, text) TO authenticated;
