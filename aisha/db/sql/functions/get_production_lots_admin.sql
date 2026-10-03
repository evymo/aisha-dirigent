-- Function: public.get_production_lots_admin
-- Returns material lots for lot genealogy and traceability
-- SECURITY DEFINER with admin guard and audit log

CREATE OR REPLACE FUNCTION public.get_production_lots_admin(
  p_item_id uuid DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_supplier_id uuid DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  lot_number text,
  item_id uuid,
  supplier_id uuid,
  supplier_lot text,
  received_at timestamptz,
  manufactured_at timestamptz,
  expires_at date,
  quantity numeric,
  remaining_quantity numeric,
  uom text,
  status text,
  coa_document_id uuid,
  storage_location_id uuid,
  batch_id uuid,
  notes text,
  metadata jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  created_by uuid
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
    p_entity_type := 'production_lot',
    p_new_values := jsonb_build_object('item_id', p_item_id, 'status', p_status, 'supplier_id', p_supplier_id),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := 'Admin read production lots',
    p_tags := ARRAY['admin', 'production_lot'],
    p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    pl.id, pl.lot_number, pl.item_id, pl.supplier_id, pl.supplier_lot,
    pl.received_at, pl.manufactured_at, pl.expires_at,
    pl.quantity, pl.remaining_quantity, pl.uom, pl.status,
    pl.coa_document_id, pl.storage_location_id, pl.batch_id,
    pl.notes, pl.metadata, pl.created_at, pl.updated_at, pl.created_by
  FROM public.production_lots pl
  WHERE (p_item_id IS NULL OR pl.item_id = p_item_id)
    AND (p_status IS NULL OR pl.status = p_status)
    AND (p_supplier_id IS NULL OR pl.supplier_id = p_supplier_id)
  ORDER BY pl.received_at DESC NULLS LAST, pl.lot_number;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_production_lots_admin(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_production_lots_admin(uuid, text, uuid) TO authenticated;
