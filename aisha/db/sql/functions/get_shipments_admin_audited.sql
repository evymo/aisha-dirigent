-- Function: public.get_shipments_admin_audited
-- Arguments: p_status text, p_limit integer
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:29+01:00

CREATE OR REPLACE FUNCTION public.get_shipments_admin_audited(p_status text DEFAULT NULL::text, p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF NOT public.has_role(v_user_id, 'admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  -- Audit log for admin shipment access
  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'admin',
      p_details := jsonb_build_object('status', p_status, 'limit', p_limit),
      p_entity_id := NULL,
      p_entity_type := 'shipments',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Admin viewing shipments',
      p_tags := ARRAY['phi', 'admin', 'shipments'],
      p_user_id := v_user_id
  );

  RETURN (
    SELECT COALESCE(jsonb_agg(row_to_json(o.*)), '[]'::jsonb)
    FROM (
      SELECT
        o.id,
        o.user_id,
        o.status,
        o.total,
        o.subtotal,
        o.tax,
        o.shipping,
        o.currency,
        o.shipping_address,
        o.billing_address,
        o.payment_method,
        o.payment_status,
        o.stripe_payment_intent_id,
        o.notes,
        o.delivered_at,
        o.created_at,
        o.updated_at,
        o.stripe_session_id,
        o.packeta_packet_id,
        o.packeta_barcode,
        o.packeta_branch_id,
        o.shipping_method,
        o.tracking_url,
        o.shipped_at
      FROM public.orders o
      WHERE (p_status IS NULL OR o.status = p_status)
      ORDER BY o.created_at DESC
      LIMIT p_limit
    ) o
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_shipments_admin_audited(p_status text, p_limit integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_shipments_admin_audited(p_status text, p_limit integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_shipments_admin_audited(p_status text, p_limit integer) TO authenticated;
