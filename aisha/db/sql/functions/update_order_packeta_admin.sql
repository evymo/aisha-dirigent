-- Function: public.update_order_packeta_admin
-- Arguments: p_order_id uuid, p_packeta_packet_id text, p_packeta_barcode text, p_tracking_url text, p_status text, p_packeta_id text (alias)
-- Description: Update order with Packeta shipment info. Admin/staff only.
-- Security: SECURITY DEFINER, admin/staff only
-- Updated: 2026-01-09 - Added p_packeta_id alias for TypeScript compatibility

CREATE OR REPLACE FUNCTION public.update_order_packeta_admin(
  p_order_id uuid,
  p_packeta_packet_id text DEFAULT NULL,
  p_packeta_barcode text DEFAULT NULL,
  p_tracking_url text DEFAULT NULL,
  p_status text DEFAULT 'processing',
  -- TypeScript compatibility alias
  p_packeta_id text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  UPDATE orders SET
    packeta_packet_id = COALESCE(p_packeta_packet_id, p_packeta_id),
    packeta_barcode = p_packeta_barcode,
    tracking_url = p_tracking_url,
    status = p_status,
    updated_at = now()
  WHERE id = p_order_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'update'::journal_action_type,
      p_area := 'orders'::journal_area,
      p_details := jsonb_build_object(
      'packeta_packet_id', COALESCE(p_packeta_packet_id, p_packeta_id),
      'status', p_status
    ),
      p_entity_id := p_order_id::text,
      p_entity_type := 'order',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'info'::journal_severity,
      p_summary := 'Admin updated Packeta shipment details',
      p_tags := ARRAY['orders', 'shipments', 'admin'],
      p_user_id := auth.uid()
  );

  RETURN FOUND;
END;
$$;

-- Permissions
REVOKE ALL ON FUNCTION public.update_order_packeta_admin(uuid, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_order_packeta_admin(uuid, text, text, text, text, text) TO authenticated;
