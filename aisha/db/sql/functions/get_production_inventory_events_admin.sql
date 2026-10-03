-- Function: public.get_production_inventory_events_admin
-- Returns inventory ledger events (immutable event-sourced stock movements)
-- SECURITY DEFINER with admin guard and audit log

CREATE OR REPLACE FUNCTION public.get_production_inventory_events_admin(
  p_event_type text DEFAULT NULL,
  p_location_id uuid DEFAULT NULL,
  p_lot_id uuid DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  lot_id uuid,
  location_id uuid,
  event_type text,
  quantity numeric,
  uom text,
  ref_type text,
  ref_id uuid,
  reason text,
  performed_by uuid,
  performed_at timestamptz,
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
    p_entity_id := NULL,
    p_entity_type := 'production_inventory_event',
    p_new_values := jsonb_build_object('event_type', p_event_type, 'lot_id', p_lot_id),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := 'Admin read production inventory events',
    p_tags := ARRAY['admin', 'production_inventory_event'],
    p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    pie.id, pie.lot_id, pie.location_id, pie.event_type,
    pie.quantity, pie.uom, pie.ref_type, pie.ref_id,
    pie.reason, pie.performed_by, pie.performed_at,
    pie.metadata, pie.created_at
  FROM public.production_inventory_events pie
  WHERE (p_event_type IS NULL OR pie.event_type = p_event_type)
    AND (p_location_id IS NULL OR pie.location_id = p_location_id)
    AND (p_lot_id IS NULL OR pie.lot_id = p_lot_id)
  ORDER BY pie.performed_at DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_production_inventory_events_admin(text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_production_inventory_events_admin(text, uuid, uuid) TO authenticated;
