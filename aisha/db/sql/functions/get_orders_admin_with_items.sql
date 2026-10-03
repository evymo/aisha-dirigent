-- Function: public.get_orders_admin_with_items
-- Arguments: p_status text, p_limit integer
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:08+01:00

CREATE OR REPLACE FUNCTION public.get_orders_admin_with_items(p_status text DEFAULT NULL::text, p_limit integer DEFAULT 500)
 RETURNS TABLE(id uuid, user_id uuid, user_email text, user_name text, status text, total numeric, subtotal numeric, shipping numeric, currency text, stripe_payment_intent_id text, shipping_address jsonb, billing_address jsonb, created_at timestamptz, updated_at timestamptz, delivered_at timestamptz, order_items jsonb)
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
      p_summary := 'Admin viewing orders with items and user info',
      p_tags := ARRAY['phi','admin','orders'],
      p_user_id := v_user_id
  );

  RETURN QUERY
  SELECT 
    o.id,
    o.user_id,
    p.email::text,
    p.display_name::text,
    o.status,
    o.total,
    o.subtotal,
    o.shipping,
    o.currency,
    o.stripe_payment_intent_id,
    o.shipping_address,
    o.billing_address,
    o.created_at,
    o.updated_at,
    o.delivered_at,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'id', oi.id,
        'product_id', oi.product_id,
        'quantity', oi.quantity,
        'price_at_purchase', oi.price_at_purchase
      )) FROM order_items oi WHERE oi.order_id = o.id),
      '[]'::jsonb
    )
  FROM orders o
  LEFT JOIN profiles p ON p.id = o.user_id
  WHERE (p_status IS NULL OR o.status = p_status)
  ORDER BY o.created_at DESC
  LIMIT p_limit;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_orders_admin_with_items(p_status text, p_limit integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_orders_admin_with_items(p_status text, p_limit integer) TO authenticated;
