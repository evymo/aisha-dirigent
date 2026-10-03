-- Function: public.upsert_production_lot_admin
-- Creates or updates a material lot
-- SECURITY DEFINER with admin guard and audit log

CREATE OR REPLACE FUNCTION public.upsert_production_lot_admin(
  p_batch_id uuid DEFAULT NULL,
  p_coa_document_id uuid DEFAULT NULL,
  p_expires_at date DEFAULT NULL,
  p_id uuid DEFAULT NULL,
  p_item_id uuid DEFAULT NULL,
  p_lot_number text DEFAULT NULL,
  p_manufactured_at timestamptz DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_notes text DEFAULT NULL,
  p_quantity numeric DEFAULT NULL,
  p_received_at timestamptz DEFAULT NULL,
  p_remaining_quantity numeric DEFAULT NULL,
  p_status text DEFAULT 'quarantine',
  p_storage_location_id uuid DEFAULT NULL,
  p_supplier_id uuid DEFAULT NULL,
  p_supplier_lot text DEFAULT NULL,
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

  IF p_lot_number IS NULL OR p_item_id IS NULL THEN
    RAISE EXCEPTION 'lot_number and item_id are required';
  END IF;

  IF p_id IS NOT NULL THEN
    v_action := 'update';
    UPDATE public.production_lots SET
      lot_number = p_lot_number,
      item_id = p_item_id,
      supplier_id = p_supplier_id,
      supplier_lot = p_supplier_lot,
      received_at = p_received_at,
      manufactured_at = p_manufactured_at,
      expires_at = p_expires_at,
      quantity = p_quantity,
      remaining_quantity = p_remaining_quantity,
      uom = p_uom,
      status = p_status,
      coa_document_id = p_coa_document_id,
      storage_location_id = p_storage_location_id,
      batch_id = p_batch_id,
      notes = p_notes,
      metadata = p_metadata,
      updated_at = now()
    WHERE id = p_id
    RETURNING id INTO v_result_id;
  ELSE
    v_action := 'create';
    INSERT INTO public.production_lots (
      lot_number, item_id, supplier_id, supplier_lot,
      received_at, manufactured_at, expires_at,
      quantity, remaining_quantity, uom, status,
      coa_document_id, storage_location_id, batch_id,
      notes, metadata, created_by
    ) VALUES (
      p_lot_number, p_item_id, p_supplier_id, p_supplier_lot,
      p_received_at, p_manufactured_at, p_expires_at,
      p_quantity, COALESCE(p_remaining_quantity, p_quantity), p_uom, p_status,
      p_coa_document_id, p_storage_location_id, p_batch_id,
      p_notes, p_metadata, auth.uid()
    )
    RETURNING id INTO v_result_id;
  END IF;

  PERFORM public.write_audit_journal(
    p_action_type := v_action::public.journal_action_type,
    p_area := 'products'::public.journal_area,
    p_details := NULL,
    p_entity_id := v_result_id::text,
    p_entity_type := 'production_lot',
    p_new_values := jsonb_build_object('lot_number', p_lot_number, 'status', p_status),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := format('Admin %s production lot %s', v_action, p_lot_number),
    p_tags := ARRAY['admin', 'production_lot'],
    p_user_id := auth.uid()
  );

  RETURN v_result_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_production_lot_admin(uuid, uuid, date, uuid, uuid, text, timestamptz, jsonb, text, numeric, timestamptz, numeric, text, uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_production_lot_admin(uuid, uuid, date, uuid, uuid, text, timestamptz, jsonb, text, numeric, timestamptz, numeric, text, uuid, uuid, text, text) TO authenticated;
