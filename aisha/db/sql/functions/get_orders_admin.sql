-- Function: public.get_orders_admin
-- Arguments: p_status text, p_limit integer
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:08+01:00

CREATE OR REPLACE FUNCTION public.get_orders_admin(p_status text DEFAULT NULL::text, p_limit integer DEFAULT 100)
 RETURNS TABLE(id uuid, user_id uuid, user_email text, user_name text, status text, total numeric, subtotal numeric, shipping numeric, currency text, shipping_address jsonb, billing_address jsonb, stripe_payment_intent_id text, delivered_at timestamptz, created_at timestamptz, updated_at timestamptz, items_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF NOT is_admin_or_staff(v_user_id) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  -- Audit log for admin sensitive data access
  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'admin',
      p_details := jsonb_build_object('status', p_status, 'limit', p_limit),
      p_entity_id := NULL,
      p_entity_type := 'orders',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Admin viewing orders with user info',
      p_tags := ARRAY['phi','admin','orders'],
      p_user_id := v_user_id
  );

  RETURN QUERY
  SELECT 
    o.id, o.user_id, p.email, p.display_name,
    o.status, o.total, o.subtotal, o.shipping, o.currency, o.shipping_address, o.billing_address,
    o.stripe_payment_intent_id, o.delivered_at, o.created_at, o.updated_at,
    (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id)
  FROM orders o
  LEFT JOIN profiles p ON p.user_id = o.user_id
  WHERE (p_status IS NULL OR o.status = p_status)
  ORDER BY o.created_at DESC
  LIMIT p_limit;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_orders_admin(p_status text, p_limit integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_orders_admin(p_status text, p_limit integer) TO authenticated;
